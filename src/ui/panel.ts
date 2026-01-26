import { Reference, InspectorState, InspectorCtx, PendingChange } from '../types';
import {
	createDialogMountIfNeeded,
	getMountedApp,
	getMountedRoot,
	loadCodexAndVue,
	mountApp,
	registerCodexComponents,
	ensureStyleElement
} from './codex';
import { getSettings, namespaceAllowed, saveSettings, settingsToTransformOptions } from './settings';
import { getWikitext } from '../data/wikitext_fetch';
import { openDiffPreview } from '../data/diff_preview';
import { groupKey } from '../core/parse_wikitext';
import { prefetchTemplateDataForWikitext } from '../data/templatedata_fetch';
import { openMassRenameDialog } from './mass_rename';
import { disableChecks, enableChecks, isChecksActive } from './checks';
import panelStyles from './panel.css';
import PANEL_TEMPLATE from './panel.template.vue';

import { alphaIndex, escapeAttr, linkifyContent, LinkifiedSegment } from '../core/string_utils';
import { MessageKey, MessageParams, RichMessageSegment, t, tRich as translateRich } from '../i18n';

import { formatCopy, transformWikitext } from "../core/build_wikitext";

const PANEL_STYLE_ELEMENT_ID = 'citeforge-panel-styles';
const HIGHLIGHT_CLASS = 'citeforge-ref-highlight';
const PORTLET_LINK_ID = 'citeforge-portlet-link';
const PANEL_SIZE_KEY = 'citeforge-panel-size';

let panelStylesInjected = false;

const escapeSelector = (value: string): string => {
	if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
		return window.CSS.escape(value);
	}
	return value.replace(/["\\]/g, '\\$&');
};

function scrollRowIntoView(refId: string): void {
	const selector = `.citeforge-row[data-ref-id="${escapeSelector(refId)}"]`;
	const row = document.querySelector<HTMLElement>(selector);
	if (row) {
		row.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}
}

function highlightReferenceEntry(refId: string): boolean {
	const selector = `li[data-citeforge-ref-id="${escapeSelector(refId)}"]`;
	const entry = document.querySelector<HTMLElement>(selector);
	if (!entry) return false;
	entry.classList.add(HIGHLIGHT_CLASS, 'citeforge-ref-blink');
	entry.scrollIntoView({ behavior: 'smooth', block: 'center' });
	setTimeout(() => {
		entry.classList.remove('citeforge-ref-blink');
		entry.classList.remove(HIGHLIGHT_CLASS);
	}, 1200);
	return true;
}

function getRefIdFromElement(el: Element | null): string | null {
	if (!el || !(el instanceof HTMLElement)) return null;
	if (el.dataset?.citeforgeRefId) return el.dataset.citeforgeRefId;
	const parent = el.closest<HTMLElement>('[data-citeforge-ref-id]');
	return parent?.dataset?.citeforgeRefId ?? null;
}

function collectAnchorTargets(anchor: Element): string[] {
	if (!(anchor instanceof HTMLElement)) return [];
	const ids = new Set<string>();
	if (anchor.id) ids.add(anchor.id);
	const href = anchor.getAttribute('href');
	if (href?.startsWith('#')) ids.add(href.slice(1));
	const sup = anchor.closest('sup[id]');
	if (sup?.id) ids.add(sup.id);
	const li = anchor.closest('li[id]');
	if (li?.id) ids.add(li.id);
	return Array.from(ids);
}

function resolveRefByTargetId(refs: Reference[], targetId: string): Reference | null {
	if (!targetId) return null;
	const targetEl = document.getElementById(targetId);
	const refId = getRefIdFromElement(targetEl);
	if (refId) {
		return refs.find((ref) => ref.id === refId) ?? null;
	}
	return refs.find((ref) =>
		ref.uses.some((use) => {
			const anchor = use.anchor;
			if (!anchor) return false;
			return collectAnchorTargets(anchor).includes(targetId);
		})
	) ?? null;
}

/**
 * Inject panel styles into the document once.
 */
function injectPanelStyles(): void {
	if (panelStylesInjected) return;
	ensureStyleElement(PANEL_STYLE_ELEMENT_ID, panelStyles);
	panelStylesInjected = true;
}

/**
 * Highlight all DOM anchors associated with a reference.
 * Clears any existing highlights before applying new ones.
 * Optionally scrolls to the first anchor and triggers a blink animation.
 * @param ref - The reference to highlight, or null to clear all.
 * @param opts - Control blink/scroll behavior.
 */
function highlightRef(ref: Reference | null, opts: { blink?: boolean; scroll?: boolean } = {}): void {
	clearHighlights();
	if (!ref) return;
	const { blink = true, scroll = true } = opts;
	const anchors: Element[] = [];
	ref.uses.forEach((use) => {
		if (use.anchor) {
			use.anchor.classList.add(HIGHLIGHT_CLASS);
			if (blink) {
				use.anchor.classList.add('citeforge-ref-blink');
			}
			anchors.push(use.anchor);
		}
	});
	// Scroll to the first highlighted anchor
	if (scroll && anchors.length > 0) {
		anchors[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
	}
}

/**
 * Remove all reference highlight styling from the document.
 */
export function clearHighlights(): void {
	document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((node) => {
		node.classList.remove(HIGHLIGHT_CLASS);
		node.classList.remove('citeforge-ref-blink');
	});
}

/**
 * Show a "Copied!" badge next to the reference row.
 * @param ref - The reference that was copied.
 */
function showCopiedBadge(ref: Reference): void {
	const name = ref.name || ref.id || '';
	const badge = document.createElement('span');
	badge.className = 'citeforge-badge';
	badge.textContent = t('ui.default.copied');
	const rows = document.querySelectorAll('.citeforge-row');
	rows.forEach((row) => {
		if (row.textContent?.includes(name)) {
			const existing = row.querySelector('.citeforge-badge');
			existing?.remove();
			row.appendChild(badge);
			setTimeout(() => badge.remove(), 900);
		}
	});
}

/**
 * Load saved panel dimensions from localStorage.
 * @returns Object with optional width and height values.
 */
function loadPanelSize(): { width?: number; height?: number } {
	try {
		const raw = localStorage.getItem(PANEL_SIZE_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as { width?: number; height?: number };
		return parsed || {};
	} catch {
		return {};
	}
}

/**
 * Save panel dimensions to localStorage for persistence.
 * @param size - Object containing width and height to save.
 */
function savePanelSize(size: { width: number; height: number }): void {
	try {
		localStorage.setItem(PANEL_SIZE_KEY, JSON.stringify(size));
	} catch {
		/* ignore */
	}
}

/**
 * Close the inspector panel and clear highlights.
 * @param state - The inspector state to update.
 */
function performClose(state: InspectorState): void {
	state.open = false;
	clearHighlights();
}

/** Interface for the inspector root component's public methods. */
type InspectorRoot = {
	setRefs: (nextRefs: Reference[]) => void;
	setVisible: (flag: boolean) => void;
	getVisible: () => boolean;
	jumpToAnchor: (targetId: string) => boolean;
	/** Set the open/collapsed state of the panel. True = open. */
	setOpen: (flag: boolean) => void;
};

/**
 * Type guard to check if a value is an InspectorRoot instance.
 * @param val - The value to check.
 * @returns True if val has the required InspectorRoot methods.
 */
function isInspectorRoot(val: unknown): val is InspectorRoot {
	return Boolean(
		val &&
		typeof (val as InspectorRoot).setRefs === 'function' &&
		typeof (val as InspectorRoot).setVisible === 'function' &&
		typeof (val as InspectorRoot).getVisible === 'function' &&
		typeof (val as InspectorRoot).jumpToAnchor === 'function' &&
		typeof (val as InspectorRoot).setOpen === 'function'
	);
}

/**
 * Open the Cite Forge inspector dialog with the given references.
 * If the dialog is already open, updates its reference list instead.
 * @param refs - Array of references to display in the inspector.
 * @param refreshFn - Optional callback to refresh the reference list.
 */
export async function openInspectorDialog(refs: Reference[], refreshFn?: () => Promise<void>): Promise<void> {
	if (!namespaceAllowed()) {
		console.warn('[Cite Forge]', t('main.namespaceMismatch'));
		return;
	}

	injectPanelStyles();

	const existingApp = getMountedApp();
	const existingRoot = getMountedRoot();
	if (existingApp && isInspectorRoot(existingRoot)) {
		existingRoot.setRefs(refs);
		return;
	}

	const refreshCallback = refreshFn;
	const { Vue, Codex } = await loadCodexAndVue();
	createDialogMountIfNeeded();

	const appOptions = {
		data(): InspectorState {
			const originalContent: Record<string, string> = {};
			refs.forEach((ref) => {
				originalContent[ref.id] = ref.contentWikitext || '';
			});
			return {
				open: false,
				visible: true,
				refs,
				selectedRef: null,
				query: '',
				settings: getSettings(),
				showSettings: false,
				minHeight: 300,
				pendingChanges: [],
				editingRefId: null,
				originalContent,
				contentDrafts: {},
				checksOn: false
			};
		},
		computed: {
			/**
			 * Check if there are any references loaded.
			 * @returns True if there are references, false otherwise.
			 */
			hasRefs(this: InspectorCtx): boolean {
				return Array.isArray(this.filteredRefs) && this.filteredRefs.length > 0;
			},

			/**
			 * Check if there are any pending changes.
			 * @returns True if there are pending changes, false otherwise.
			 */
			hasPendingChanges(this: InspectorCtx): boolean {
				return this.pendingChanges.length > 0;
			},

			/**
			 * Determine whether the Save button should be available.
			 * @returns True when there are pending changes or cosmetic saves are enabled.
			 */
			canSaveChanges(this: InspectorCtx): boolean {
				return this.hasPendingChanges || Boolean(this.settings.allowCosmeticSaves);
			},

			/**
			 * Get a set of reference names that have conflicts (duplicates).
			 * @returns Set of conflicting reference names.
			 */
			nameConflicts(this: InspectorCtx): Set<string> {
				const counts = new Map<string, number>();
				this.refs.forEach((ref) => {
					if (!ref.name) return;
					const key = ref.name.trim();
					if (!key) return;
					counts.set(key, (counts.get(key) || 0) + 1);
				});
				const dupes = new Set<string>();
				counts.forEach((count, key) => {
					if (count > 1) dupes.add(key);
				});
				return dupes;
			},

			/**
			 * Check if there are any reference name conflicts.
			 * @returns True if there are conflicts, false otherwise.
			 */
			hasConflicts(this: InspectorCtx): boolean {
				return (this.nameConflicts?.size ?? 0) > 0;
			},

			/**
			 * Get options for reference name copy formatting.
			 * @returns Array of label/value pairs for copy format selection.
			 */
			copyFormatOptions(): Array<{ label: string; value: string }> {
				return [
					{ label: t('ui.panel.copyOptions.raw'), value: 'raw' },
					{ label: t('ui.panel.copyOptions.rTemplate'), value: 'r' },
					{ label: t('ui.panel.copyOptions.refTag'), value: 'ref' }
				];
			},
			/**
			 * Get options for date formatting when normalizing.
			 * @returns Array of label/value pairs for date format selection.
			 */
			dateFormatOptions(): Array<{ label: string; value: 'iso' | 'mdy' | 'dmy' }> {
				return [
					{ label: t('ui.panel.settings.dateFormat.iso'), value: 'iso' },
					{ label: t('ui.panel.settings.dateFormat.mdy'), value: 'mdy' },
					{ label: t('ui.panel.settings.dateFormat.dmy'), value: 'dmy' }
				];
			},

			/**
			 * Get options for reference re-placement strategies.
			 * @returns Array of label/value pairs for re-placement selection.
			 */
			placementOptions(): Array<{ label: string; value: 'keep' | 'threshold' | 'all_ldr' | 'all_inline' }> {
				return [
					{ label: t('ui.panel.placement.keep'), value: 'keep' },
					{ label: t('ui.panel.placement.threshold'), value: 'threshold' },
					{ label: t('ui.panel.placement.allLdr'), value: 'all_ldr' },
					{ label: t('ui.panel.placement.allInline'), value: 'all_inline' }
				];
			},

			/**
			 * Get the label for the save button, including pending change count.
			 * @returns Localized save button label string.
			 */
			saveButtonLabel(this: InspectorCtx): string {
				return t('ui.panel.saveButton.label', [String(this.pendingChanges.length)]);
			},

			/**
			 * Get the filtered and sorted list of references based on the search query.
			 * @returns Array of filtered and sorted Reference objects.
			 */
			sortedRefs(this: InspectorCtx): Reference[] {
				const arr = Array.isArray(this.refs) ? this.refs.slice() : [];
				arr.sort((a, b) => {
					const ga = groupKey(a.name);
					const gb = groupKey(b.name);
					if (ga !== gb) return alphaIndex(ga) - alphaIndex(gb);
					return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base', numeric: true });
				});
				return arr;
			},

			/**
			 * Get the list of references filtered by the current search query.
			 * @returns Array of Reference objects matching the query.
			 */
			filteredRefs(this: InspectorCtx): Reference[] {
				const q = (this.query || '').toLowerCase();
				if (!q) return this.sortedRefs;
				return this.sortedRefs.filter((ref) => {
					const name = ref.name?.toLowerCase() || '';
					const content = ref.contentWikitext?.toLowerCase() || '';
					return name.includes(q) || content.includes(q);
				});
			},

			/**
			 * Get a mapping of group keys to the first reference ID in that group.
			 * @returns Record mapping group keys to reference IDs.
			 */
			firstByBucket(this: InspectorCtx): Record<string, string> {
				const map: Record<string, string> = {};
				this.filteredRefs.forEach((ref) => {
					const bucket = groupKey(ref.name);
					if (!map[bucket]) {
						map[bucket] = `citeforge-anchor-${bucket}`;
					}
				});
				return map;
			}
		},
		methods: {
			/**
			 * Check if a reference is currently being edited for content.
			 * @param ref - Reference object.
			 * @returns True if editing, false otherwise.
			 */
			isEditingContent(this: InspectorCtx, ref: Reference): boolean {
				return this.contentDrafts[ref.id] !== undefined;
			},

			/**
			 * Convert wikitext content into link segments, with optional fallback text.
			 * @param content - Content to linkify.
			 * @param fallback - Text to display when there is no content.
			 * @returns Array of segments for safe rendering.
			 */
			linkifyOrFallback(this: InspectorCtx, content: string, fallback: string): LinkifiedSegment[] {
				const segments = linkifyContent(content);
				if (!segments.length && fallback) {
					return [{ type: 'text', text: fallback }];
				}
				return segments;
			},

			/**
			 * Toggle the content editor for a reference.
			 * @param ref - Reference object.
			 */
			toggleContentEditor(this: InspectorCtx, ref: Reference): void {
				if (this.contentDrafts[ref.id] !== undefined) {
					const drafts = { ...this.contentDrafts };
					delete drafts[ref.id];
					this.contentDrafts = drafts;
					return;
				}
				this.contentDrafts = {
					...this.contentDrafts,
					[ref.id]: ref.contentWikitext || ''
				};
			},

			/**
			 * Handle input events in the content editor for a reference.
			 * @param ref - Reference object.
			 * @param value - New content value from the editor.
			 */
			onContentInput(this: InspectorCtx, ref: Reference, value: string): void {
				this.contentDrafts = {
					...this.contentDrafts,
					[ref.id]: value
				};
				ref.contentWikitext = value;
				this.queueContentChange(ref, value);
			},

			/**
			 * Queue a content change for a reference.
			 * @param ref - Reference object.
			 * @param nextContent - The new content to set.
			 */
			queueContentChange(this: InspectorCtx, ref: Reference, nextContent: string): void {
				const original = this.originalContent[ref.id] ?? '';
				const existing = this.pendingChanges.find((c) => c.refId === ref.id);
				if (nextContent === original) {
					if (existing) {
						existing.newContent = undefined;
						this.cleanupPendingEntry(existing);
					}
					return;
				}
				const entry = this.ensurePendingEntry(ref);
				entry.oldContent = entry.oldContent ?? original;
				entry.newContent = nextContent;
			},

			/**
			 * Ensure there is a pending change entry for a reference.
			 * @param ref - Reference object.
			 * @param originalNameOverride - Optional original name override.
			 * @returns The existing or newly created PendingChange entry.
			 */
			ensurePendingEntry(this: InspectorCtx, ref: Reference, originalNameOverride?: string): PendingChange {
				let entry = this.pendingChanges.find((c) => c.refId === ref.id);
				if (!entry) {
					entry = {
						refId: ref.id,
						oldName: originalNameOverride ?? ref.name ?? '',
						oldContent: this.originalContent[ref.id] ?? ref.contentWikitext ?? ''
					};
					this.pendingChanges.push(entry);
				} else {
					if (!entry.oldName && (originalNameOverride || ref.name)) {
						entry.oldName = originalNameOverride ?? ref.name ?? '';
					}
					if (entry.oldContent === undefined) {
						entry.oldContent = this.originalContent[ref.id] ?? ref.contentWikitext ?? '';
					}
				}
				return entry;
			},

			/**
			 * Clean up a pending change entry if there are no actual changes.
			 * @param entry - The PendingChange entry to check and possibly remove.
			 */
			cleanupPendingEntry(this: InspectorCtx, entry: PendingChange): void {
				const nameChanged = entry.newName !== undefined && entry.newName !== entry.oldName;
				const contentChanged =
					entry.newContent !== undefined &&
					entry.oldContent !== undefined &&
					entry.newContent !== entry.oldContent;
				if (!nameChanged && !contentChanged) {
					const idx = this.pendingChanges.indexOf(entry);
					if (idx >= 0) {
						this.pendingChanges.splice(idx, 1);
					}
				}
			},

			/**
			 * Localized message retrieval function.
			 * @param key - Message key.
			 * @param params - Optional parameters for message formatting.
			 * @returns Localized message string.
			 */
			t(key: MessageKey, params?: MessageParams): string {
				return t(key, params);
			},

			/**
			 * Localized message retrieval with wiki link segments.
			 * @param key - Message key.
			 * @param params - Optional parameters for message formatting.
			 * @returns Array of rich message segments.
			 */
			tRich(this: InspectorCtx, key: MessageKey, params?: MessageParams): RichMessageSegment[] {
				return translateRich(key, params);
			},

			/**
			 * Get the display name of a reference.
			 * @param ref - Reference object.
			 * @returns The name of the reference or '(nameless)' if not named.
			 */
			refName(this: InspectorCtx, ref: Reference): string {
				return ref?.name ?? t('ui.default.nameless');
			},

			/**
			 * Get the number of uses for a reference.
			 * @param ref - Reference object.
			 * @returns Number of uses of the reference.
			 */
			refUses(this: InspectorCtx, ref: Reference): number {
				return ref?.uses?.length ?? 0;
			},

			/**
			 * Get the grouping bucket for a reference based on its name.
			 * @param ref - Reference object.
			 * @returns The group key for the reference.
			 */
			bucketFor(this: InspectorCtx, ref: Reference): string {
				return groupKey(ref?.name);
			},

			/**
			 * Select a reference and highlight it in the document.
			 * @param ref - Reference to select.
			 */
			selectRef(this: InspectorCtx, ref: Reference): void {
				this.selectedRef = ref;
				clearHighlights();
			},

			/**
			 * Whether the given reference has any inline citation anchors found in the document.
			 * @param ref - Reference to check.
			 */
			hasCitations(this: InspectorCtx, ref: Reference): boolean {
				if (!ref) return false;
				return Array.isArray(ref.uses) && ref.uses.some((use) => Boolean(use.anchor));
			},

			/**
			 * Whether the given reference has a corresponding entry in the references list.
			 * @param ref - Reference to check.
			 */
			hasReferenceEntry(this: InspectorCtx, ref: Reference): boolean {
				if (!ref) return false;
				try {
					const sel = `li[data-citeforge-ref-id="${escapeSelector(ref.id)}"]`;
					return Boolean(document.querySelector(sel));
				} catch {
					return false;
				}
			},

			jumpToCitations(this: InspectorCtx, ref?: Reference): void {
				const target = ref ?? this.selectedRef;
				if (!target) return;
				clearHighlights();
				highlightRef(target);
			},

			jumpToReference(this: InspectorCtx, ref?: Reference): void {
				const target = ref ?? this.selectedRef;
				if (!target) return;
				clearHighlights();
				if (!highlightReferenceEntry(target.id)) {
					mw.notify?.(t('ui.panel.referenceJumpUnavailable'), { type: 'warn', title: 'Cite Forge' });
				}
			},

			jumpToAnchor(this: InspectorCtx, targetId: string): boolean {
				const ref = resolveRefByTargetId(this.refs, targetId);
				if (!ref) return false;
				this.visible = true;
				this.open = true;
				this.selectedRef = ref;
				setTimeout(() => {
					scrollRowIntoView(ref.id);
				}, 0);
				return true;
			},

			/**
			 * Set the list of references in the inspector.
			 * @param nextRefs - Array of Reference objects to set.
			 */
			setRefs(this: InspectorCtx, nextRefs: Reference[]): void {
				const prevId = this.selectedRef?.id;
				this.refs = nextRefs;
				const nextSelected = prevId ? nextRefs.find((r) => r.id === prevId) ?? nextRefs[0] : nextRefs[0];
				this.selectedRef = nextSelected ?? null;
				const nextOriginal: Record<string, string> = {};
				nextRefs.forEach((ref) => {
					nextOriginal[ref.id] = ref.contentWikitext || '';
				});
				this.originalContent = nextOriginal;
				const preservedDrafts: Record<string, string | undefined> = {};
				Object.keys(this.contentDrafts).forEach((key) => {
					if (nextOriginal[key] !== undefined) {
						preservedDrafts[key] = this.contentDrafts[key];
					}
				});
				this.contentDrafts = preservedDrafts;
				this.pendingChanges = this.pendingChanges.filter((change) => nextOriginal[change.refId] !== undefined);
				this.visible = true;
				if (this.checksOn) {
					enableChecks(this.refs);
					this.checksOn = isChecksActive();
				}
				if (this.open && this.selectedRef) {
					highlightRef(this.selectedRef);
				} else {
					clearHighlights();
				}
			},

			/**
			 * Set the current visibility state of the inspector panel.
			 * @param show - True to show, false to hide.
			 */
			setVisible(this: InspectorCtx, show: boolean): void {
				this.visible = show;
				if (!show) {
					this.open = false;
					clearHighlights();
					disableChecks();
					this.checksOn = false;
				}
			},

			/**
			 * Set the open/collapsed state of the panel. True = open.
			 */
			setOpen(this: InspectorCtx, flag: boolean): void {
				this.open = Boolean(flag);
				if (this.open && this.selectedRef) {
					highlightRef(this.selectedRef);
				}
				if (!this.open) {
					performClose(this);
				}
			},

			/**
			 * Get the current visibility state of the inspector panel.
			 * @returns True if visible, false otherwise.
			 */
			getVisible(this: InspectorCtx): boolean {
				return this.visible;
			},

			/**
			 * Handle updates to the open state of the panel.
			 * @param newValue - New open state.
			 */
			onUpdateOpen(this: InspectorCtx, newValue: boolean): void {
				if (!newValue) {
					performClose(this);
				}
			},

			closeDialog(this: InspectorCtx): void {
				performClose(this);
			},

			/**
			 * Scroll to the first reference in the specified bucket.
			 * @param bucket - The group key bucket to scroll to.
			 */
			scrollToBucket(this: InspectorCtx, bucket: string): void {
				const targetId = this.firstByBucket[bucket];
				if (!targetId) return;
				const el = document.getElementById(targetId);
				if (el) {
					el.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'smooth' });
				}
			},

			/**
			 * Refresh the reference list by invoking the provided callback.
			 */
			async refreshList(): Promise<void> {
				if (refreshCallback) {
					await refreshCallback();
				}
			},

			/**
			 * Open the mass rename dialog for bulk renaming references.
			 */
			openMassRename(this: InspectorCtx & { applyMassRename: (renameMap: Record<string, string | null>, renameNameless: Record<string, string | null>) => void }): void {
				void openMassRenameDialog(this.refs, {
					onApply: (renameMap, renameNameless) => {
						this.applyMassRename(renameMap, renameNameless);
					}
				});
			},

			/**
			 * Toggle the checks feature on or off.
			 */
			toggleChecks(this: InspectorCtx): void {
				console.info('[Cite Forge][Checks] Toggle requested', { current: this.checksOn, refs: this.refs.length });
				if (isChecksActive() || this.checksOn) {
					disableChecks();
					this.checksOn = false;
					console.info('[Cite Forge][Checks] Turned off');
					return;
				}
				enableChecks(this.refs);
				this.checksOn = isChecksActive();
				console.info('[Cite Forge][Checks] Turned on', { active: this.checksOn });
			},

			/**
			 * Handle input events on the search query field.
			 * @param evt - Input event.
			 */
			onQueryInput(this: InspectorCtx, evt: Event): void {
				const target = evt.target as HTMLInputElement | null;
				this.query = target?.value ?? '';
			},

			/**
			 * Check if a reference has a name conflict.
			 * @param ref - Reference object.
			 * @returns True if there is a conflict, false otherwise.
			 */
			refHasConflict(this: InspectorCtx, ref: Reference): boolean {
				if (!ref.name) return false;
				const conflicts = this.nameConflicts;
				return conflicts instanceof Set ? conflicts.has(ref.name.trim()) : false;
			},

			/**
			 * Copy the name of a reference to the clipboard.
			 */
			copyRefName(this: InspectorCtx, ref?: Reference): void {
				const targetRef = ref ?? this.selectedRef;
				if (!targetRef) return;
				const name = targetRef.name || '';
				if (!name) return;
				const formatted = formatCopy(name, this.settings.copyFormat);
				void navigator.clipboard?.writeText(formatted).catch(() => {
					/* ignore */
				});
				showCopiedBadge(targetRef);
			},

			/**
			 * Copy the full wikitext of a reference to the clipboard.
			 */
			copyRefContent(this: InspectorCtx, ref?: Reference): void {
				const targetRef = ref ?? this.selectedRef;
				if (!targetRef) {
					mw.notify?.(t('ui.panel.noRefToCopy'), { type: 'warn', title: 'Cite Forge' });
					return;
				}
				const name = targetRef.name ? ` name="${escapeAttr(targetRef.name)}"` : '';
				const group = targetRef.group ? ` group="${escapeAttr(targetRef.group)}"` : '';
				const content = (targetRef.contentWikitext || '').trim();
				const raw = content
					? `<ref${name}${group}>${content}</ref>`
					: `<ref${name}${group} />`;
				void navigator.clipboard?.writeText(raw).catch(() => {
					/* ignore */
				});
				showCopiedBadge(targetRef);
			},

			/**
			 * Begin editing the name of a reference.
			 * Focuses the input field for immediate typing.
			 * @param ref - Reference to edit.
			 */
			editRefName(this: InspectorCtx, ref: Reference): void {
				this.editingRefId = ref.id;
				// Focus the input after Vue updates the DOM
				setTimeout(() => {
					const input = document.querySelector<HTMLInputElement>('.citeforge-row__name-input');
					if (input) {
						input.focus();
						input.select();
					}
				}, 0);
			},

			/**
			 * Commit the new name for a reference from an event.
			 * @param ref - Reference being renamed.
			 * @param event - Event containing the new name value.
			 */
			commitRefNameFromEvent(this: InspectorCtx & { commitRefName: (ref: Reference, newName: string) => void }, ref: Reference, event: Event): void {
				const target = event.target as HTMLInputElement | null;
				const value = (target?.value ?? '').trim();
				this.commitRefName(ref, value);
			},

			/**
			 * Commit the new name for a reference.
			 * Updates pending changes and reference state accordingly.
			 * @param ref - Reference being renamed.
			 * @param newName - The new name to set.
			 */
			commitRefName(this: InspectorCtx, ref: Reference, newName: string): void {
				const nextName = newName.trim();
				const pending = this.pendingChanges.find((c) => c.refId === ref.id);
				const originalName = pending?.oldName ?? ref.name ?? '';
				this.editingRefId = null;
				ref.name = nextName;
				if (nextName === originalName) {
					if (pending) {
						pending.newName = undefined;
						this.cleanupPendingEntry(pending);
					}
					return;
				}
				const entry = pending ?? this.ensurePendingEntry(ref, originalName);
				entry.newName = nextName;
			},

			/**
			 * Cancel editing the name of a reference.
			 * Restores the original name if there was a pending change.
			 * @param ref - Reference being edited.
			 */
			cancelEditRefName(this: InspectorCtx, ref: Reference): void {
				// Restore original name if there was a pending change
				const pending = this.pendingChanges.find((c) => c.refId === ref.id);
				if (pending) {
					ref.name = pending.oldName;
					pending.newName = undefined;
					this.cleanupPendingEntry(pending);
				}
				this.editingRefId = null;
			},

			/**
			 * Apply mass rename changes from the provided maps.
			 * Updates references and pending changes accordingly.
			 * @param renameMap - Mapping of current names to new names.
			 * @param renameNameless - Mapping of reference IDs to new names for nameless refs.
			 */
			applyMassRename(this: InspectorCtx, renameMap: Record<string, string | null>, renameNameless: Record<string, string | null>): void {
				this.editingRefId = null;
				this.refs.forEach((ref) => {
					const currentName = ref.name || '';
					const proposed = currentName ? renameMap[currentName] : renameNameless[ref.id];
					if (proposed === undefined || proposed === null) return;
					const existing = this.pendingChanges.find((c) => c.refId === ref.id);
					const originalName = existing ? existing.oldName : currentName;
					ref.name = proposed;
					if (proposed === originalName) {
						if (existing) {
							existing.newName = undefined;
							this.cleanupPendingEntry(existing);
						}
						return;
					}
					const entry = existing ?? this.ensurePendingEntry(ref, originalName);
					entry.newName = proposed;
				});
				if (!this.pendingChanges.length) {
					mw.notify?.(t('ui.panel.noMassRenameChanges'), { type: 'info', title: 'Cite Forge' });
				} else {
					mw.notify?.(t('ui.panel.massRenamePopulated'), {
						type: 'info',
						title: 'Cite Forge'
					});
				}
			},

			/**
			 * Toggle the visibility of the settings panel.
			 */
			toggleSettings(this: InspectorCtx): void {
				this.showSettings = !this.showSettings;
			},

			/**
			 * Save all pending changes and open a diff preview.
			 * Validates for conflicts before proceeding.
			 */
			async saveChanges(this: InspectorCtx): Promise<void> {
				if (this.hasConflicts) {
					mw.notify?.(t('ui.panel.resolveDuplicates'), { type: 'error', title: 'Cite Forge' });
					return;
				}
				const allowCosmetic = Boolean(this.settings.allowCosmeticSaves);
				if (!this.pendingChanges.length && !allowCosmetic) {
					mw.notify?.(t('ui.panel.noPendingChanges'), { type: 'info' });
					return;
				}
				try {
					const base = await getWikitext();
					const renameMap: Record<string, string | null> = {};
					const renameNameless: Record<string, string | null> = {};
					const contentOverrides: Record<string, string> = {};
					this.pendingChanges.forEach((c) => {
						if (c.newName && c.oldName !== c.newName) {
							if (c.oldName) {
								renameMap[c.oldName] = c.newName;
							} else {
								renameNameless[c.refId] = c.newName;
							}
						}
						const newContent = c.newContent;
						const oldContent = c.oldContent;
						if (
							newContent !== undefined &&
							oldContent !== undefined &&
							newContent !== oldContent
						) {
							contentOverrides[c.refId] = newContent;
							const ref = this.refs.find((r) => r.id === c.refId);
							if (ref) {
								const names = Array.from(
									new Set(
										[c.newName, ref.name, c.oldName]
											.filter((name): name is string => Boolean(name && name.trim()))
									)
								);
								names.forEach((name) => {
									const key = `${ref.group ?? ''}::${name}`;
									contentOverrides[key] = newContent;
								});
							}
						}
					});

					const transformOpts = settingsToTransformOptions(this.settings, renameMap, renameNameless, contentOverrides);

					if (transformOpts.normalizeAll || transformOpts.dedupe) {
						await prefetchTemplateDataForWikitext(base);
					}

					const result = transformWikitext(base, transformOpts);

					if (result.wikitext === base) {
						mw.notify?.(t('ui.panel.noChangesGenerated'), { type: 'info' });
						return;
					}

					openDiffPreview(result.wikitext, t('ui.panel.diffSummary'));
					mw.notify?.(t('ui.panel.openingDiff'), { type: 'info' });
				} catch (err: unknown) {
					console.error('[Cite Forge] Failed to apply changes', err);
					mw.notify?.(t('ui.panel.diffFailed'), { type: 'error' });
				}
			},

			/**
			 * Save the current settings and close the settings panel.
			 */
			saveSettings(this: InspectorCtx): void {
				saveSettings(this.settings);
				this.showSettings = false;
			},

			/**
			 * Start resizing the panel based on mouse events.
			 * @param event - The initial mousedown event.
			 */
			startResize(this: InspectorCtx, event: MouseEvent): void {
				const panelEl = document.querySelector<HTMLElement>('.citeforge-panel');
				if (!panelEl) return;
				const startW = panelEl.offsetWidth;
				const startH = panelEl.offsetHeight;
				const startX = event.clientX;
				const startY = event.clientY;
				const onMove = (e: MouseEvent) => {
					const newW = Math.max(320, startW + (e.clientX - startX));
					const newH = Math.max(300, startH - (e.clientY - startY));
					panelEl.style.width = `${newW}px`;
					panelEl.style.height = `${newH}px`;
				};
				const onUp = (e: MouseEvent) => {
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
					document.body.style.cursor = '';
					const newW = Math.max(320, startW + (e.clientX - startX));
					const newH = Math.max(300, startH - (e.clientY - startY));
					savePanelSize({ width: newW, height: newH });
				};
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
				document.body.style.cursor = 'nwse-resize';
			}
		},
		mounted(this: InspectorCtx) {
			if (this.open && this.selectedRef) {
				highlightRef(this.selectedRef, { blink: false, scroll: false });
			}
			const panelEl = document.querySelector<HTMLElement>('.citeforge-panel');
			const sz = loadPanelSize();
			if (panelEl) {
				if (sz.width) panelEl.style.width = `${sz.width}px`;
				if (sz.height) panelEl.style.height = `${sz.height}px`;
			}
			applyMinHeight(this);
		},
		beforeUnmount() {
			clearHighlights();
			disableChecks();
		},
		template: PANEL_TEMPLATE
	};

	const app = Vue.createMwApp(appOptions);

	registerCodexComponents(app, Codex);
	mountApp(app);
}

/**
 * Get the ID used for the Cite Forge portlet link element.
 * @returns The portlet link element ID string.
 */
export function getPortletLinkId(): string {
	return PORTLET_LINK_ID;
}

/**
 * Set the visibility state of the Cite Forge panel.
 * Updates both the Vue component state and localStorage.
 * @param show - Whether the panel should be visible.
 */
export function setHubVisible(show: boolean): void {
	const root = getMountedRoot();
	if (isInspectorRoot(root)) {
		root.setVisible(show);
	}
	try {
		localStorage.setItem('citeforge-visible', show ? '1' : '0');
	} catch {
		/* ignore */
	}
}

/**
 * Check if the Cite Forge panel is currently visible.
 * Checks the Vue component state first, then falls back to localStorage.
 * @returns True if the panel is visible.
 */
export function isHubVisible(): boolean {
	const root = getMountedRoot();
	if (isInspectorRoot(root)) {
		return root.getVisible();
	}
	try {
		return localStorage.getItem('citeforge-visible') === '1';
	} catch {
		return false;
	}
}

export function getInspectorRoot(): InspectorRoot | null {
	const root = getMountedRoot();
	return isInspectorRoot(root) ? root : null;
}

export function jumpToInspectorAnchor(targetId: string): boolean {
	const root = getInspectorRoot();
	if (!root) return false;
	return root.jumpToAnchor(targetId);
}

/**
 * Calculate and apply minimum height to the panel based on content.
 * Ensures the panel is tall enough to show the index and topbar.
 * @param state - The inspector state to update with minHeight.
 */
function applyMinHeight(state: InspectorCtx): void {
	const panelEl = document.querySelector<HTMLElement>('.citeforge-panel');
	const indexCol = document.querySelector<HTMLElement>('.citeforge-panel__index');
	const topbarEl = document.querySelector<HTMLElement>('.citeforge-list-topbar');
	const headerEl = document.querySelector<HTMLElement>('.citeforge-panel__header');
	if (!panelEl) return;
	const pad = 24; // body padding approx
	const headerH = headerEl?.offsetHeight || 0;
	const topbarH = topbarEl?.offsetHeight || 0;
	const indexH = indexCol?.scrollHeight || 0;
	const needed = headerH + pad + topbarH + indexH + 16;
	state.minHeight = Math.max(300, needed);
	const currentH = panelEl.offsetHeight;
	if (currentH < state.minHeight) {
		panelEl.style.height = `${state.minHeight}px`;
	}
}
