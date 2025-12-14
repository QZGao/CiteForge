import { Reference } from '../types';
import { ensureMount, ensureStyleElement, loadCodexAndVue, registerCodexComponents } from './codex';
import { groupKey, isAutoName, getRefContentMap } from '../core/references';
import styles from './mass_rename.css';
import MASS_RENAME_TEMPLATE from './mass_rename.template.vue';
import {
	alphaIndex
} from '../core/string_utils';
import { getWikitext } from '../data/wikitext_fetch';
import {
	DEFAULT_FIELDS,
	IncrementStyle,
	MassRenameConfig,
	NAMING_FIELDS,
	NamingField,
	RefMetadata,
	buildSuggestion,
	createDefaultConfig,
	extractMetadata,
	normalizeFieldSelection,
	normalizeKey
} from '../core/mass_rename';

type VueModule = { createMwApp: (options: unknown) => VueApp };
type VueApp = { mount: (selector: string) => unknown; component?: (name: string, value: unknown) => VueApp };

const STYLE_ID = 'citeforge-mass-rename-styles';
const MOUNT_ID = 'citeforge-mass-rename-mount';
type ApplyCallback = (renameMap: Record<string, string | null>, renameNameless: Record<string, string | null>) => void;
type MassRenameOptions = { onApply?: ApplyCallback };
let onApplyMassRename: ApplyCallback | null = null;

interface RenameRow {
	ref: Reference;
	metadata: RefMetadata;
	active: boolean;
	autoName: boolean;
	suggestion: string;
	locked: boolean;
	error: string | null;
	snippet: string;
}

type ContentStats = {
	fromRef: number;
	mapByName: number;
	mapById: number;
	missing: Array<{ id: string; name: string | null }>;
};

interface MassRenameState {
	open: boolean;
	query: string;
	showInactive: boolean;
	rows: RenameRow[];
	config: MassRenameConfig;
	conflictKeys: string[];
	applyBusy: boolean;
	fieldMenuItems: Array<{ value: NamingField; label: string; description?: string }>;
	fieldMenuConfig: { visibleItemLimit: number };
	fieldInput: string;
	fieldChips: Array<{ label: string; value: NamingField }>;
	fieldSelection: NamingField[];
}

type MassRenameCtx = MassRenameState & {
	queryRows: RenameRow[];
	sortedRows: RenameRow[];
	filteredRows: RenameRow[];
	activeCount: number;
	hasConflicts: boolean;
	conflictCount: number;
	applyDisabled: boolean;
	incrementOptions: Array<{ label: string; value: IncrementStyle }>;
	selectAllChecked: boolean;
	selectAllIndeterminate: boolean;
};

type MassRenameRoot = {
	setRefs: (next: Reference[], contentMap?: Map<string, string>) => void;
	openDialog: () => void;
};

const FIELD_OPTIONS: Array<{ value: NamingField; label: string; description?: string }> = [
	{ value: 'last', label: 'Author last name', description: 'Uses last/surname or author field' },
	{ value: 'first', label: 'Author first name', description: 'Uses first/given name' },
	{ value: 'author', label: 'Author (full)', description: 'Full author string' },
	{ value: 'title', label: 'Title', description: 'Title/chapter/contribution' },
	{ value: 'work', label: 'Work/publication', description: 'Journal, newspaper, website, periodical' },
	{ value: 'publisher', label: 'Publisher/institution', description: 'Publisher or institution field' },
	{ value: 'domain', label: 'Website domain', description: 'Domain derived from URL' },
	{ value: 'domainShort', label: 'Website domain (short)', description: 'Domain without public suffix' },
	{ value: 'phrase', label: 'First phrase', description: 'First few words of the reference text' },
	{ value: 'year', label: 'Year', description: 'Year from date/year fields' },
	{ value: 'fulldate', label: 'Full date (yyyymmdd)', description: 'Full date in yyyymmdd format when available' }
];

const FIELD_MENU_CONFIG = { visibleItemLimit: 8 };

/**
 * Convert a NamingField to a chip object for UI display.
 * @param field - NamingField value.
 * @returns Chip object with label and value.
 */
function chipForField(field: NamingField): { label: string; value: NamingField } {
	const option = FIELD_OPTIONS.find((o) => o.value === field);
	return { label: option?.label || field, value: field };
}

/**
 * Convert a selection of NamingFields to chip objects for UI display.
 * @param selection - Array of NamingField values.
 * @returns Array of chip objects.
 */
function chipsFromSelection(selection: NamingField[]): Array<{ label: string; value: NamingField }> {
	return normalizeFieldSelection(selection, NAMING_FIELDS).map(chipForField);
}

let mountedApp: VueApp | null = null;
let mountedRoot: unknown = null;

/**
 * Type guard to check if a value is a MassRenameRoot.
 * @param val - Value to check.
 * @returns True if val is a MassRenameRoot, false otherwise.
 */
function isMassRenameRoot(val: unknown): val is MassRenameRoot {
	return Boolean(val && typeof (val as MassRenameRoot).setRefs === 'function' && typeof (val as MassRenameRoot).openDialog === 'function');
}

/**
 * Validate rename rows for conflicts and errors.
 * @param rows - Array of RenameRow objects.
 * @returns Array of conflicting normalized keys.
 */
function validateRows(rows: RenameRow[]): string[] {
	const usage = new Map<string, number>();
	const bump = (key: string | null) => {
		if (!key) return;
		usage.set(key, (usage.get(key) || 0) + 1);
	};

	rows.forEach((row) => {
		if (!row.active) {
			if (row.ref.name) bump(normalizeKey(row.ref.name));
			return;
		}
		bump(normalizeKey(row.suggestion));
	});

	const conflicts = new Set<string>();
	usage.forEach((count, key) => {
		if (count > 1) conflicts.add(key);
	});

	rows.forEach((row) => {
		row.error = null;
		if (!row.active) return;
		const trimmed = (row.suggestion || '').trim();
		if (!trimmed) {
			row.error = 'Enter a name for this reference.';
			return;
		}
		if (/^\d+$/.test(trimmed)) {
			row.error = 'Names cannot be numbers only.';
			return;
		}
		if (/[<>{}\[\]|"]/.test(trimmed)) {
			row.error = 'Contains invalid characters.';
			return;
		}
		if (conflicts.has(normalizeKey(trimmed))) {
			row.error = 'Conflicts with another reference name.';
		}
	});

	return Array.from(conflicts);
}

/**
 * Regenerate suggestions for rename rows based on configuration.
 * @param rows - Array of RenameRow objects.
 * @param config - MassRenameConfig object.
 * @param respectLocked - Whether to respect locked rows.
 * @returns Array of conflicting normalized keys.
 */
function regenerate(rows: RenameRow[], config: MassRenameConfig, respectLocked: boolean): string[] {
	const reserved = new Set<string>();
	rows.forEach((row) => {
		if (!row.active) {
			if (row.ref.name) {
				const norm = normalizeKey(row.ref.name);
				if (norm) reserved.add(norm);
			}
			return;
		}
		if (respectLocked && row.locked) {
			const norm = normalizeKey(row.suggestion);
			if (norm) reserved.add(norm);
		}
	});

	rows.forEach((row) => {
		if (!row.active) return;
		const suggestion = buildSuggestion(row.metadata, row.ref, config, reserved);
		row.suggestion = suggestion;
		row.locked = false;
		const norm = normalizeKey(row.suggestion);
		if (norm) reserved.add(norm);
	});

	return validateRows(rows);
}

/**
 * Resolve the content for a reference using various sources.
 * @param ref - Reference object.
 * @param contentMap - Optional map of reference names/ids to content.
 * @param stats - Optional ContentStats object to track resolution stats.
 * @returns Resolved content string.
 */
function resolveContent(ref: Reference, contentMap?: Map<string, string>, stats?: ContentStats): string {
	const fromRef = ref.contentWikitext || '';
	if (fromRef.trim()) {
		if (stats) stats.fromRef += 1;
		return fromRef;
	}
	if (ref.name && contentMap?.has(ref.name)) {
		const hit = contentMap.get(ref.name) || '';
		if (stats) stats.mapByName += 1;
		// console.info('[Cite Forge][mass-rename] Using map content by name', { name: ref.name, length: hit.length });
		return hit;
	}
	if (contentMap?.has(ref.id)) {
		const hit = contentMap.get(ref.id) || '';
		if (stats) stats.mapById += 1;
		// console.info('[Cite Forge][mass-rename] Using map content by id', { id: ref.id, length: hit.length });
		return hit;
	}
	if (stats) stats.missing.push({ id: ref.id, name: ref.name ?? null });
	return '';
}

/**
 * Prepare rename rows from references and optional content map.
 * @param refs - Array of Reference objects.
 * @param contentMap - Optional map of reference names/ids to content.
 * @returns Array of RenameRow objects.
 */
function prepareRows(refs: Reference[], contentMap?: Map<string, string>): RenameRow[] {
	const stats: ContentStats = { fromRef: 0, mapByName: 0, mapById: 0, missing: [] };
	const rows = refs.map((ref) => {
		const content = resolveContent(ref, contentMap, stats);
		const snippet = (content || '').replace(/\s+/g, ' ').trim();
		const metadata = extractMetadata(ref, content);
		// if (!content.trim()) {
		// 	console.info('[Cite Forge][mass-rename] Missing content for ref', {
		// 		refId: ref.id,
		// 		name: ref.name,
		// 		hasMapMatch: Boolean((ref.name && contentMap?.has(ref.name)) || contentMap?.has(ref.id)),
		// 		mapSize: contentMap?.size ?? 0
		// 	});
		// }
		const auto = isAutoName(ref.name);
		return {
			ref,
			metadata,
			active: !ref.name || auto,
			autoName: auto,
			suggestion: ref.name || '',
			locked: false,
			error: null,
			snippet
		};
	});
	// console.info('[Cite Forge][mass-rename] Content resolution stats', {
	// 	totalRefs: refs.length,
	// 	fromRef: stats.fromRef,
	// 	mapByName: stats.mapByName,
	// 	mapById: stats.mapById,
	// 	missing: stats.missing.slice(0, 5)
	// });
	return rows;
}

/**
 * Check if a rename row matches the search query.
 * @param row - RenameRow object.
 * @param q - Search query string.
 * @returns True if the row matches the query, false otherwise.
 */
function matchesQuery(row: RenameRow, q: string): boolean {
	if (!q) return true;
	const needle = q.toLowerCase();
	const haystack = [
		row.ref.name || '',
		row.suggestion || '',
		row.metadata.title || '',
		row.metadata.author || '',
		row.metadata.domain || '',
		row.snippet || ''
	]
		.join(' ')
		.toLowerCase();
	return haystack.includes(needle);
}

/**
 * Build a content map for references using wikitext and existing content.
 * @param refs - Array of Reference objects.
 * @returns Map of reference names/ids to content strings.
 */
async function buildContentMap(refs: Reference[]): Promise<Map<string, string>> {
	const map = new Map<string, string>();
	try {
		const wikitext = await getWikitext();
		const parsedMap = getRefContentMap(wikitext);
		parsedMap.forEach((content, key) => {
			map.set(key, content);
		});
		refs.forEach((ref) => {
			const content = (ref.contentWikitext || '').trim();
			if (!content) return;
			if (ref.name && !map.has(ref.name)) map.set(ref.name, content);
			if (!map.has(ref.id)) map.set(ref.id, content);
		});
	} catch {
		refs.forEach((ref) => {
			const content = (ref.contentWikitext || '').trim();
			if (!content) return;
			if (ref.name && !map.has(ref.name)) map.set(ref.name, content);
			if (!map.has(ref.id)) map.set(ref.id, content);
		});
	}
	// console.info('[Cite Forge][mass-rename] Built ref content map', {
	// 	totalEntries: map.size,
	// 	withName: Array.from(map.keys()).filter((k) => !k.startsWith('__nameless_')).length,
	// 	sample: Array.from(map.entries()).slice(0, 5).map(([k, v]) => ({ key: k, len: v.length }))
	// });
	return map;
}

/**
 * Open the mass rename dialog for the provided references.
 * @param refs - Array of Reference objects to rename.
 * @param options - Optional MassRenameOptions.
 */
export async function openMassRenameDialog(refs: Reference[], options?: MassRenameOptions): Promise<void> {
	ensureStyleElement(STYLE_ID, styles);
	ensureMount(MOUNT_ID);
	onApplyMassRename = options?.onApply || null;

	const contentMap = await buildContentMap(refs);
	// console.info('[Cite Forge][mass-rename] Opening dialog with refs', {
	// 	refCount: refs.length,
	// 	contentKeys: contentMap.size
	// });

	if (mountedApp && isMassRenameRoot(mountedRoot)) {
		mountedRoot.setRefs(refs, contentMap);
		mountedRoot.openDialog();
		return;
	}

	const { Vue, Codex } = await loadCodexAndVue();
	const baseRows = prepareRows(refs, contentMap);

	const appOptions = {
		data(): MassRenameState {
			return {
				open: true,
				query: '',
				showInactive: false,
				rows: baseRows,
				config: createDefaultConfig(),
				conflictKeys: [],
				applyBusy: false,
				fieldMenuItems: FIELD_OPTIONS,
				fieldMenuConfig: FIELD_MENU_CONFIG,
				fieldInput: '',
				fieldSelection: [...DEFAULT_FIELDS],
				fieldChips: chipsFromSelection(DEFAULT_FIELDS)
			};
		},
		computed: {
			/**
			 * Get increment style options for the UI.
			 * @returns Array of label/value pairs for increment styles.
			 */
			incrementOptions(): Array<{ label: string; value: IncrementStyle }> {
				return [
					{ label: 'Latin letters (a, b, c)', value: 'latin' },
					{ label: 'Numbers (2, 3, 4)', value: 'numeric' }
				];
			},

			/**
			 * Get rows matching the current search query.
			 * @returns Array of RenameRow objects.
			 */
			queryRows(this: MassRenameCtx): RenameRow[] {
				return this.sortedRows.filter((row) => matchesQuery(row, this.query));
			},

			/**
			 * Get rows sorted by group key and name.
			 * @returns Array of RenameRow objects.
			 */
			sortedRows(this: MassRenameCtx): RenameRow[] {
				return this.rows.slice().sort((a, b) => {
					const ga = groupKey(a.ref.name);
					const gb = groupKey(b.ref.name);
					if (ga !== gb) return alphaIndex(ga) - alphaIndex(gb);
					return (a.ref.name || '').localeCompare(b.ref.name || '', undefined, { sensitivity: 'base', numeric: true });
				});
			},

			/**
			 * Get rows filtered by active/inactive status.
			 * @returns Array of RenameRow objects.
			 */
			filteredRows(this: MassRenameCtx): RenameRow[] {
				return this.queryRows.filter((row) => this.showInactive || row.active);
			},

			/**
			 * Count of active rows.
			 * @returns Number of active RenameRow objects.
			 */
			activeCount(this: MassRenameCtx): number {
				return this.rows.filter((r) => r.active).length;
			},

			/**
			 * Check if there are any conflicts in the current rows.
			 * @returns True if there are conflicts, false otherwise.
			 */
			hasConflicts(this: MassRenameCtx): boolean {
				return this.conflictKeys.length > 0;
			},

			/**
			 * Count of conflicting keys.
			 * @returns Number of conflicting normalized keys.
			 */
			conflictCount(this: MassRenameCtx): number {
				return this.conflictKeys.length;
			},

			/**
			 * Determine if the apply button should be disabled.
			 * @returns True if apply is disabled, false otherwise.
			 */
			applyDisabled(this: MassRenameCtx): boolean {
				const hasError = this.rows.some((row) => row.active && (row.error || !(row.suggestion || '').trim()));
				return this.applyBusy || hasError || this.activeCount === 0;
			},

			/**
			 * Check if all query rows are selected.
			 * @returns True if all query rows are active, false otherwise.
			 */
			selectAllChecked(this: MassRenameCtx): boolean {
				if (!this.queryRows.length) return false;
				return this.queryRows.every((row) => row.active);
			},

			/**
			 * Check if some but not all query rows are selected.
			 * @returns True if some query rows are active, false otherwise.
			 */
			selectAllIndeterminate(this: MassRenameCtx): boolean {
				const active = this.queryRows.filter((row) => row.active).length;
				return active > 0 && active < this.queryRows.length;
			}
		},
		watch: {
			config: {
				handler(this: MassRenameCtx) {
					this.conflictKeys = regenerate(this.rows, this.config, true);
				},
				deep: true
			}
		},
		methods: {
			openDialog(this: MassRenameCtx): void {
				this.open = true;
				this.conflictKeys = regenerate(this.rows, this.config, true);  // Ensure suggestions are up to date
			},
			closeDialog(this: MassRenameCtx): void {
				this.open = false;
			},

			/**
			 * Set the references to rename and prepare rows.
			 * @param next - Array of Reference objects.
			 * @param contentMap - Optional map of reference names/ids to content.
			 */
			setRefs(this: MassRenameCtx, next: Reference[], contentMap?: Map<string, string>): void {
				this.rows = prepareRows(next, contentMap);
				this.conflictKeys = regenerate(this.rows, this.config, true);
			},

			/**
			 * Handle input in the search query field.
			 * @param evt - Input event.
			 */
			onQueryInput(this: MassRenameCtx, evt: Event): void {
				const target = evt.target as HTMLInputElement | null;
				this.query = target?.value ?? '';
			},

			/**
			 * Get the grouping bucket for a rename row.
			 * @param row - RenameRow object.
			 * @returns Group key string.
			 */
			bucketFor(this: MassRenameCtx, row: RenameRow): string {
				return groupKey(row.ref.name);
			},

			/**
			 * Handle input in the field selection filter.
			 * @param value - Input string.
			 */
			onFieldInput(this: MassRenameCtx, value: string): void {
				this.fieldInput = value;
				const lower = value.toLowerCase();
				this.fieldMenuItems = lower
					? FIELD_OPTIONS.filter((opt) => opt.label.toLowerCase().includes(lower))
					: FIELD_OPTIONS;
			},

			/**
			 * Handle selection changes in the field selection menu.
			 * @param value - Array of selected NamingField values.
			 */
			onFieldSelection(this: MassRenameCtx, value: NamingField[]): void {
				const normalized = normalizeFieldSelection(value || [], NAMING_FIELDS);
				this.fieldSelection = normalized;
				this.fieldChips = chipsFromSelection(normalized);
				this.config.fields = normalized;
				this.conflictKeys = regenerate(this.rows, this.config, true);
			},

			/**
			 * Regenerate suggestions for all rows.
			 * @param respectLocked - Whether to respect locked rows.
			 */
			regenerateSuggestions(this: MassRenameCtx, respectLocked = true): void {
				this.conflictKeys = regenerate(this.rows, this.config, respectLocked);
			},

			/**
			 * Reset all settings and rows to default.
			 */
			resetAll(this: MassRenameCtx): void {
				this.config = createDefaultConfig();
				this.fieldSelection = [...DEFAULT_FIELDS];
				this.fieldChips = chipsFromSelection(DEFAULT_FIELDS);
				this.fieldMenuItems = FIELD_OPTIONS;
				this.fieldInput = '';
				this.rows.forEach((row) => {
					row.locked = false;
				});
				this.conflictKeys = regenerate(this.rows, this.config, false);
			},

			/**
			 * Handle toggling the active state of a row.
			 * @param row - RenameRow object.
			 */
			onToggleRow(this: MassRenameCtx, row: RenameRow): void {
				row.locked = false;
				if (row.active) {
					this.conflictKeys = regenerate(this.rows, this.config, true);
				} else {
					row.error = null;
					this.conflictKeys = validateRows(this.rows);
				}
			},

			/**
			 * Handle editing the suggestion of a row.
			 * @param row - RenameRow object.
			 * @param value - New suggestion string.
			 */
			onSuggestionEdited(this: MassRenameCtx, row: RenameRow, value: string): void {
				row.suggestion = value;
				row.locked = true;
				this.conflictKeys = validateRows(this.rows);
			},

			/**
			 * Handle toggling the active state of all query rows.
			 * @param checked - Whether all rows should be active.
			 */
			onToggleAll(this: MassRenameCtx, checked: boolean): void {
				this.queryRows.forEach((row) => {
					row.active = checked;
					if (!checked) {
						row.locked = false;
						row.error = null;
					}
				});
				this.conflictKeys = regenerate(this.rows, this.config, true);
			},

			/**
			 * Regenerate the suggestion for a specific row.
			 * @param row - RenameRow object.
			 */
			regenerateRow(this: MassRenameCtx, row: RenameRow): void {
				row.locked = false;
				this.conflictKeys = regenerate(this.rows, this.config, true);
			},

			/**
			 * Apply the rename changes.
			 */
			applyRenames(this: MassRenameCtx): void {
				if (this.applyDisabled) return;
				const renameMap: Record<string, string | null> = {};
				const renameNameless: Record<string, string | null> = {};
				this.rows.forEach((row) => {
					if (!row.active) return;
					const newName = (row.suggestion || '').trim();
					if (!newName) return;
					if (row.ref.name) {
						if (row.ref.name !== newName) {
							renameMap[row.ref.name] = newName;
						}
					} else {
						renameNameless[row.ref.id] = newName;
					}
				});

				if (!Object.keys(renameMap).length && !Object.keys(renameNameless).length) {
					mw.notify?.('No rename changes to apply.', { type: 'info', title: 'Cite Forge' });
					return;
				}

				try {
					this.applyBusy = true;
					if (onApplyMassRename) {
						onApplyMassRename(renameMap, renameNameless);
						mw.notify?.('Applied to inspector. Review and save there to preview diffs.', {
							type: 'info',
							title: 'Cite Forge'
						});
						this.open = false;
					} else {
						mw.notify?.('No inspector available to receive mass rename changes.', {
							type: 'warn',
							title: 'Cite Forge'
						});
					}
				} catch (err: unknown) {
					console.error('[Cite Forge] Mass rename failed', err);
					mw.notify?.('Mass rename could not apply changes. Please try again.', {
						type: 'error',
						title: 'Cite Forge'
					});
				} finally {
					this.applyBusy = false;
				}
			}
		},
		created(this: MassRenameCtx) {
			this.conflictKeys = regenerate(this.rows, this.config, false);
		},
		template: MASS_RENAME_TEMPLATE
	};

	const app = (Vue as VueModule).createMwApp(appOptions);
	registerCodexComponents(app, Codex);
	mountedApp = app;
	mountedRoot = app.mount(`#${MOUNT_ID}`);
}
