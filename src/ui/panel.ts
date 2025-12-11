import { Reference } from '../types';
import {
	createDialogMountIfNeeded,
	getMountedApp,
	getMountedRoot,
	loadCodexAndVue,
	mountApp,
	registerCodexComponents
} from './codex';
import { getSettings, namespaceAllowed, saveSettings } from './settings';
import { initCitationPopup } from './citations';

const HIGHLIGHT_CLASS = 'citehub-ref-highlight';
const PORTLET_LINK_ID = 'citehub-portlet-link';
const PANEL_SIZE_KEY = 'citehub-panel-size';

/** Internal state for the inspector panel Vue component. */
type InspectorState = {
	open: boolean;
	visible: boolean;
	refs: Reference[];
	selectedRef: Reference | null;
	query: string;
	settings: ReturnType<typeof getSettings>;
	showSettings: boolean;
	minHeight: number;
};

/** Extended context including computed properties for the inspector. */
type InspectorCtx = InspectorState & {
	sortedRefs: Reference[];
	filteredRefs: Reference[];
	firstByBucket: Record<string, string>;
};

/**
 * Highlight all DOM anchors associated with a reference.
 * Clears any existing highlights before applying new ones.
 * @param ref - The reference to highlight, or null to clear all.
 */
function highlightRef(ref: Reference | null): void {
	clearHighlights();
	if (!ref) return;
	ref.uses.forEach((use) => {
		if (use.anchor) {
			use.anchor.classList.add(HIGHLIGHT_CLASS);
		}
	});
}

/**
 * Remove all reference highlight styling from the document.
 */
export function clearHighlights(): void {
	document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((node) => {
		node.classList.remove(HIGHLIGHT_CLASS);
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
type InspectorRoot = { setRefs: (nextRefs: Reference[]) => void; setVisible: (flag: boolean) => void; getVisible: () => boolean };

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
		typeof (val as InspectorRoot).getVisible === 'function'
	);
}

/**
 * Open the Cite Hub inspector dialog with the given references.
 * If the dialog is already open, updates its reference list instead.
 * @param refs - Array of references to display in the inspector.
 * @param refreshFn - Optional callback to refresh the reference list.
 */
export async function openInspectorDialog(refs: Reference[], refreshFn?: () => Promise<void>): Promise<void> {
	if (!namespaceAllowed()) {
		mw.notify?.('Cite Hub is disabled in this namespace or content model.', { type: 'warn' });
		return;
	}

	const existingApp = getMountedApp();
	const existingRoot = getMountedRoot();
	if (existingApp && isInspectorRoot(existingRoot)) {
		existingRoot.setRefs(refs);
		return;
	}

	const refreshCallback = refreshFn;
	const { Vue, Codex } = await loadCodexAndVue();
	createDialogMountIfNeeded();
	initCitationPopup();

	const appOptions = {
		data(): InspectorState {
			return {
				open: false,
				visible: true,
				refs,
				selectedRef: refs[0] ?? null,
				query: '',
				settings: getSettings(),
				showSettings: false,
				minHeight: 260
			};
		},
		computed: {
			hasRefs(this: InspectorCtx): boolean {
				return Array.isArray(this.filteredRefs) && this.filteredRefs.length > 0;
			},
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
			filteredRefs(this: InspectorCtx): Reference[] {
				const q = (this.query || '').toLowerCase();
				if (!q) return this.sortedRefs;
				return this.sortedRefs.filter((ref) => {
					const name = ref.name?.toLowerCase() || '';
					const content = ref.contentWikitext?.toLowerCase() || '';
					return name.includes(q) || content.includes(q);
				});
			},
			firstByBucket(this: InspectorCtx): Record<string, string> {
				const map: Record<string, string> = {};
				this.filteredRefs.forEach((ref) => {
					const bucket = groupKey(ref.name);
					if (!map[bucket]) {
						map[bucket] = `citehub-anchor-${bucket}`;
					}
				});
				return map;
			}
		},
		methods: {
			refName(this: InspectorCtx, ref: Reference): string {
				return ref?.name ?? '(nameless)';
			},
			refUses(this: InspectorCtx, ref: Reference): number {
				return ref?.uses?.length ?? 0;
			},
			bucketFor(this: InspectorCtx, ref: Reference): string {
				return groupKey(ref?.name);
			},
			selectRef(this: InspectorCtx, ref: Reference): void {
				this.selectedRef = ref;
				highlightRef(ref);
			},
			setRefs(this: InspectorCtx, nextRefs: Reference[]): void {
				const prevId = this.selectedRef?.id;
				this.refs = nextRefs;
				const nextSelected = prevId ? nextRefs.find((r) => r.id === prevId) ?? nextRefs[0] : nextRefs[0];
				this.selectedRef = nextSelected ?? null;
				this.visible = true;
				if (this.selectedRef) {
					highlightRef(this.selectedRef);
				} else {
					clearHighlights();
				}
			},
			setVisible(this: InspectorCtx, show: boolean): void {
				this.visible = show;
				if (!show) {
					this.open = false;
					clearHighlights();
				}
			},
			getVisible(this: InspectorCtx): boolean {
				return this.visible;
			},
			onUpdateOpen(this: InspectorCtx, newValue: boolean): void {
				if (!newValue) {
					performClose(this);
				}
			},
			closeDialog(this: InspectorCtx): void {
				performClose(this);
			},
			scrollToBucket(this: InspectorCtx, bucket: string): void {
				const targetId = this.firstByBucket[bucket];
				if (!targetId) return;
				const el = document.getElementById(targetId);
				if (el) {
					el.scrollIntoView({ block: 'nearest', inline: 'start', behavior: 'smooth' });
				}
			},
			async refreshList(): Promise<void> {
				if (refreshCallback) {
					await refreshCallback();
				}
			},
			onQueryInput(this: InspectorCtx, evt: Event): void {
				const target = evt.target as HTMLInputElement | null;
				this.query = target?.value ?? '';
			},
			copyRefName(this: InspectorCtx, ref: Reference): void {
				const name = ref.name || '';
				if (!name) return;
				const formatted = formatCopy(name, this.settings.copyFormat);
				void navigator.clipboard?.writeText(formatted).catch(() => {
					/* ignore */
				});
				const badge = document.createElement('span');
				badge.className = 'citehub-badge';
				badge.textContent = 'Copied!';
				const rows = document.querySelectorAll('.citehub-row');
				rows.forEach((row) => {
					if (row.textContent?.includes(name)) {
						const existing = row.querySelector('.citehub-badge');
						existing?.remove();
						row.appendChild(badge);
						setTimeout(() => badge.remove(), 900);
					}
				});
			},
			toggleSettings(this: InspectorCtx): void {
				this.showSettings = !this.showSettings;
			},
			saveSettings(this: InspectorCtx): void {
				saveSettings(this.settings);
				this.showSettings = false;
			},
			startResize(this: InspectorCtx, event: MouseEvent): void {
				const panelEl = document.querySelector<HTMLElement>('.citehub-panel');
				if (!panelEl) return;
				const startW = panelEl.offsetWidth;
				const startH = panelEl.offsetHeight;
				const startX = event.clientX;
				const startY = event.clientY;
				const onMove = (e: MouseEvent) => {
					const newW = Math.max(360, startW + (e.clientX - startX));
					const newH = Math.max(260, startH - (e.clientY - startY));
					panelEl.style.width = `${newW}px`;
					panelEl.style.height = `${newH}px`;
				};
				const onUp = (e: MouseEvent) => {
					document.removeEventListener('mousemove', onMove);
					document.removeEventListener('mouseup', onUp);
					document.body.style.cursor = '';
					const newW = Math.max(360, startW + (e.clientX - startX));
					const newH = Math.max(260, startH - (e.clientY - startY));
					savePanelSize({ width: newW, height: newH });
				};
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
				document.body.style.cursor = 'nwse-resize';
			}
		},
		mounted(this: InspectorCtx) {
			if (this.selectedRef) {
				highlightRef(this.selectedRef);
			}
			const panelEl = document.querySelector<HTMLElement>('.citehub-panel');
			const sz = loadPanelSize();
			if (panelEl) {
				if (sz.width) panelEl.style.width = `${sz.width}px`;
				if (sz.height) panelEl.style.height = `${sz.height}px`;
			}
			applyMinHeight(this);
		},
		beforeUnmount() {
			clearHighlights();
		},
		template: `
			<div class="citehub-shell" v-if="visible">
				<button
					class="citehub-launcher"
					v-if="!open"
					type="button"
					@click.prevent="open = true"
					title="Open Cite Hub"
				>
					<span class="citehub-launcher__icon">✎</span>
					<span class="citehub-launcher__label">Citations</span>
				</button>

				<div class="citehub-panel" :class="{ 'is-open': open }">
					<div class="citehub-panel__header">
						<div class="citehub-panel__title">Cite Hub – Inspector</div>
						<div class="citehub-panel__actions">
							<cdx-button weight="quiet" size="small" @click.prevent="closeDialog">
								Collapse
							</cdx-button>
						</div>
					</div>
					<div class="citehub-panel__body">
						<div class="citehub-panel__index">
							<button
								v-for="letter in ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '*']"
								:key="letter"
								type="button"
								class="citehub-index-btn"
								:disabled="!firstByBucket[letter]"
								@click.prevent="scrollToBucket(letter)"
							>
								{{ letter }}
							</button>
						</div>
						<div class="citehub-panel__list">
							<div class="citehub-list-topbar">
								<input
									class="citehub-search"
									type="search"
									:placeholder="'Search citations…'"
									:aria-label="'Search citations'"
									:value="query"
									@input="onQueryInput"
								/>
								<cdx-button
									weight="quiet"
									size="small"
									:title="'Refresh'"
									:aria-label="'Refresh'"
									@click.prevent="refreshList"
								>
									<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
										<path fill="currentColor" d="M15.65 4.35A8 8 0 1 0 17.4 13h-2.22a6 6 0 1 1-1-7.22L11 9h7V2z"/>
									</svg>
								</cdx-button>
							</div>
							<div v-if="hasRefs" class="citehub-list-wrap">
								<div
									v-for="(ref, idx) in filteredRefs"
									:key="ref.id || idx"
									:id="idx === 0 || bucketFor(filteredRefs[idx - 1]) !== bucketFor(ref) ? 'citehub-anchor-' + bucketFor(ref) : null"
									class="citehub-row"
									:class="{ 'is-selected': selectedRef && selectedRef.id === ref.id }"
									@click.prevent="selectRef(ref)"
								>
									<div class="citehub-row__title">
										<span class="citehub-row__name">{{ refName(ref) }}</span>
										<span class="citehub-row__meta">Uses: {{ refUses(ref) }} <span v-if="ref.group">· {{ ref.group }}</span></span>
									</div>
									<div class="citehub-row__snippet">{{ (ref.contentWikitext || '').slice(0, 200) || '(No inline content captured)' }}</div>
									<div class="citehub-row__actions">
										<button class="citehub-copy-btn" type="button" @click.stop.prevent="copyRefName(ref)" :title="'Copy ref name'">
											<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
												<path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
											</path>
											</svg>
										</button>
									</div>
								</div>
							</div>
							<div v-else class="citehub-empty">No references found on this page.</div>
						</div>
						<div class="citehub-panel__toolbar">
							<button class="citehub-tool-btn" type="button" title="Settings" @click.prevent="toggleSettings">
								<span class="citehub-tool-icon" aria-hidden="true">
									<svg viewBox="0 0 20 20" width="16" height="16" xmlns:xlink="http://www.w3.org/1999/xlink">
										<g transform="translate(10 10)">
											<path fill="currentColor" id="a" d="M1.5-10h-3l-1 6.5h5m0 7h-5l1 6.5h3"/>
											<use xlink:href="#a" transform="rotate(45)" fill="currentColor"/>
											<use xlink:href="#a" transform="rotate(90)" fill="currentColor"/>
											<use xlink:href="#a" transform="rotate(135)" fill="currentColor"/>
										</g>
										<path fill="currentColor" d="M10 2.5a7.5 7.5 0 0 0 0 15 7.5 7.5 0 0 0 0-15v4a3.5 3.5 0 0 1 0 7 3.5 3.5 0 0 1 0-7"/>
									</svg>
								</span>
								<span class="citehub-tool-label">Settings</span>
							</button>
							<button class="citehub-tool-btn" type="button" title="Mass rename (soon)">
								<span class="citehub-tool-icon" aria-hidden="true">
									<svg viewBox="0 0 20 20" width="16" height="16">
										<path fill="currentColor" d="M6 3H5V1h1c.768 0 1.47.289 2 .764A3 3 0 0 1 10 1h1v2h-1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h1v2h-1c-.768 0-1.47-.289-2-.764A3 3 0 0 1 6 19H5v-2h1a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1m6 12h6a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-6v2h6v6h-6zm-8-2v2H2a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2v2H2v6z"/>
									</svg>
								</span>
								<span class="citehub-tool-label">Mass rename</span>
							</button>
							<button class="citehub-tool-btn" type="button" title="Structure tools (soon)">
								<span class="citehub-tool-icon" aria-hidden="true">
									<svg viewBox="0 0 20 20" width="16" height="16">
										<path fill="currentColor" d="M7 15h12v2H7zm0-6h12v2H7zm0-6h12v2H7zM2 6h1V1H1v1h1zm1 9v1H2v1h1v1H1v1h3v-5H1v1zM1 8v1h2v1H1.5a.5.5 0 0 0-.5.5V13h3v-1H2v-1h1.5a.5.5 0 0 0 .5-.5v-2a.5.5 0 0 0-.5-.5z"/>
									</svg>
								</span>
								<span class="citehub-tool-label">Structure</span>
							</button>
							<button class="citehub-tool-btn" type="button" title="Checks (soon)">
								<span class="citehub-tool-icon" aria-hidden="true">
									<svg viewBox="0 0 20 20" width="16" height="16">
										<path fill="currentColor" d="m.29 12.71 1.42-1.42 2.22 2.22 8.3-10.14 1.54 1.26-9.7 11.86zM12 10h5v2h-5zm-3 4h5v2H9zm6-8h5v2h-5z"/>
									</svg>
								</span>
								<span class="citehub-tool-label">Checks</span>
							</button>
						</div>
						<div
							class="citehub-settings"
							v-if="showSettings"
						>
							<div class="citehub-settings__title">Cite Hub Settings</div>
							<label class="citehub-settings__row">
								<span>Copy format</span>
								<select v-model="settings.copyFormat">
									<option value="raw">raw name</option>
									<option value="r">{{ '{' }}{r|name}}</option>
									<option value="ref">&lt;ref name="name" /&gt;</option>
								</select>
							</label>
							<label class="citehub-settings__row">
								<input type="checkbox" v-model="settings.showCiteRefCopyBtn" />
								<span>Show citation hover copy popup</span>
							</label>
							<label class="citehub-settings__row">
								<input type="checkbox" v-model="settings.showInUserNs" />
								<span>Enable in User namespace</span>
							</label>
							<div class="citehub-settings__actions">
								<cdx-button weight="quiet" size="small" @click.prevent="saveSettings">
									Save
								</cdx-button>
								<cdx-button weight="quiet" size="small" @click.prevent="toggleSettings">
									Close
								</cdx-button>
							</div>
						</div>
					</div>
					<div class="citehub-resizer" @mousedown.prevent="startResize"></div>
				</div>
			</div>
		`
	};

	const app = Vue.createMwApp(appOptions);

	registerCodexComponents(app, Codex);
	mountApp(app);
}

/**
 * Get the ID used for the Cite Hub portlet link element.
 * @returns The portlet link element ID string.
 */
export function getPortletLinkId(): string {
	return PORTLET_LINK_ID;
}

/**
 * Set the visibility state of the Cite Hub panel.
 * Updates both the Vue component state and localStorage.
 * @param show - Whether the panel should be visible.
 */
export function setHubVisible(show: boolean): void {
	const root = getMountedRoot();
	if (isInspectorRoot(root)) {
		root.setVisible(show);
	}
	try {
		localStorage.setItem('citehub-visible', show ? '1' : '0');
	} catch {
		/* ignore */
	}
}

/**
 * Check if the Cite Hub panel is currently visible.
 * Checks the Vue component state first, then falls back to localStorage.
 * @returns True if the panel is visible.
 */
export function isHubVisible(): boolean {
	const root = getMountedRoot();
	if (isInspectorRoot(root)) {
		return root.getVisible();
	}
	try {
		return localStorage.getItem('citehub-visible') === '1';
	} catch {
		return false;
	}
}

/**
 * Get the alphabetical grouping key for a reference name.
 * Returns '#' for numeric, '*' for unnamed/special, or uppercase letter.
 * @param name - The reference name to categorize.
 * @returns Single character representing the group.
 */
function groupKey(name: string | null | undefined): string {
	if (!name) return '*';
	const first = name.trim().charAt(0);
	if (!first) return '*';
	if (/[0-9]/.test(first)) return '#';
	if (/[a-z]/i.test(first)) return first.toUpperCase();
	return '*';
}

/**
 * Get the sort index for an alphabetical group character.
 * Used to sort references by their group key.
 * @param char - The group character to get the index for.
 * @returns Numeric index for sorting (0-27, with 28 for unknown).
 */
function alphaIndex(char: string): number {
	const alphabet = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '*'];
	const idx = alphabet.indexOf(char);
	return idx === -1 ? alphabet.length : idx;
}

/**
 * Calculate and apply minimum height to the panel based on content.
 * Ensures the panel is tall enough to show the index and topbar.
 * @param state - The inspector state to update with minHeight.
 */
function applyMinHeight(state: InspectorCtx): void {
	const panelEl = document.querySelector<HTMLElement>('.citehub-panel');
	const indexCol = document.querySelector<HTMLElement>('.citehub-panel__index');
	const topbarEl = document.querySelector<HTMLElement>('.citehub-list-topbar');
	const headerEl = document.querySelector<HTMLElement>('.citehub-panel__header');
	if (!panelEl) return;
	const pad = 24; // body padding approx
	const headerH = headerEl?.offsetHeight || 0;
	const topbarH = topbarEl?.offsetHeight || 0;
	const indexH = indexCol?.scrollHeight || 0;
	const needed = headerH + pad + topbarH + indexH + 16;
	state.minHeight = Math.max(260, needed);
	const currentH = panelEl.offsetHeight;
	if (currentH < state.minHeight) {
		panelEl.style.height = `${state.minHeight}px`;
	}
}

/**
 * Format a reference name for copying based on user preference.
 * @param name - The reference name to format.
 * @param fmt - The format style: 'raw', 'r' (template), or 'ref' (tag).
 * @returns Formatted string ready for clipboard.
 */
function formatCopy(name: string, fmt: 'raw' | 'r' | 'ref'): string {
	if (fmt === 'r') return `{{r|${name}}}`;
	if (fmt === 'ref') return `<ref name="${escapeAttr(name)}" />`;
	return name;
}

/**
 * Escape double quotes in a string for use in HTML attributes.
 * @param value - The string to escape.
 * @returns String with double quotes replaced by &quot;.
 */
function escapeAttr(value: string): string {
	return value.replace(/"/g, '&quot;');
}
