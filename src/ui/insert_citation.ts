import { fetchTemplateDataOrder, getTemplateAliasMap, getTemplateParamOrder } from '../data/templatedata_fetch';
import { MessageKey, MessageParams, t } from '../i18n';
import { ensureMount, ensureStyleElement, loadCodexAndVue, registerCodexComponents } from './codex';
import styles from './insert_citation.css';
import TEMPLATE from './insert_citation.template.vue';

type VueModule = { createMwApp: (options: unknown) => VueApp };
type VueApp = { mount: (selector: string) => unknown; component?: (name: string, value: unknown) => VueApp };

type DefaultRowSpec = { kind: 'param'; name: string } | { kind: 'author'; mode?: 'split' | 'single' };

export type ParamField = {
	name: string;
	value: string;
};

export type InsertCitationParamRow = {
	id: string;
	kind: 'param';
	field: ParamField;
};

export type InsertCitationAuthorRow = {
	id: string;
	kind: 'author';
	index: number;
	mode: 'split' | 'single';
	split: {
		last: ParamField;
		first: ParamField;
		link: ParamField;
	};
	single: {
		author: ParamField;
		link: ParamField;
	};
};

export type InsertCitationRow = InsertCitationParamRow | InsertCitationAuthorRow;

export type InsertionTarget = {
	textarea: HTMLTextAreaElement;
	selectionStart: number;
	selectionEnd: number;
	scrollTop: number;
	scrollLeft: number;
};

type InsertCitationState = {
	open: boolean;
	templateName: string;
	refName: string;
	rows: InsertCitationRow[];
	allParamOptions: string[];
	loadingParams: boolean;
	dialogName: string;
	paramDatalistId: string;
	requestToken: number;
};

type InsertCitationVm = InsertCitationState & {
	openDialog: (templateName: string, target: InsertionTarget | null) => void;
	closeDialog: () => void;
	loadTemplateParams: (templateName: string) => Promise<void>;
	addParamRow: () => void;
	addNameRow: () => void;
	removeRow: (rowId: string) => void;
	setAuthorMode: (row: InsertCitationAuthorRow, useSingle: boolean) => void;
	insertCitation: () => void;
	t: (key: MessageKey, params?: MessageParams) => string;
};

type InsertCitationRoot = Pick<InsertCitationVm, 'openDialog'>;

type WikiEditorContext = {
	$textarea?: JQuery;
	textarea?: HTMLTextAreaElement;
};

const DIALOG_NAME = 'insert_citation';
const STYLE_ID = 'citeforge-insert-citation-styles';
const MOUNT_ID = `citeforge-${DIALOG_NAME}-mount`;
const TOOL_NAME = 'citeforgeInsertCitation';
const TOOLBAR_READY_DELAY_MS = 1000;
const TOOLBAR_ICON = `data:image/svg+xml,${encodeURIComponent(
	"<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'><path fill='#1d3557' d='M4 4h5v5H6.8L7 10.7A3.2 3.2 0 0 1 4 14V4zm7 0h5v5h-2.2L14 10.7A3.2 3.2 0 0 1 11 14V4z'/><path fill='#5d7ea6' d='M4 15h12v1H4z'/></svg>"
)}`;

const SUPPORTED_INSERT_CITATION_TEMPLATES = [
	'cite web',
	'cite news',
	'cite book',
	'cite journal',
	'cite AV media',
	'cite video game'
];

const DEFAULT_TEMPLATE_ROWS: Record<string, DefaultRowSpec[]> = {
	'cite web': [
		{ kind: 'author' },
		{ kind: 'param', name: 'url' },
		{ kind: 'param', name: 'title' },
		{ kind: 'param', name: 'website' },
		{ kind: 'param', name: 'date' },
		{ kind: 'param', name: 'access-date' },
		{ kind: 'param', name: 'language' }
	],
	'cite news': [
		{ kind: 'author' },
		{ kind: 'param', name: 'url' },
		{ kind: 'param', name: 'title' },
		{ kind: 'param', name: 'work' },
		{ kind: 'param', name: 'date' },
		{ kind: 'param', name: 'access-date' },
		{ kind: 'param', name: 'language' }
	],
	'cite book': [
		{ kind: 'author' },
		{ kind: 'param', name: 'title' },
		{ kind: 'param', name: 'publisher' },
		{ kind: 'param', name: 'location' },
		{ kind: 'param', name: 'date' },
		{ kind: 'param', name: 'isbn' },
		{ kind: 'param', name: 'page' },
		{ kind: 'param', name: 'language' }
	],
	'cite magazine': [
		{ kind: 'author' },
		{ kind: 'param', name: 'magazine' },
		{ kind: 'param', name: 'issue' },
		{ kind: 'param', name: 'date' },
		{ kind: 'param', name: 'title' },
		{ kind: 'param', name: 'page' },
		{ kind: 'param', name: 'language' }
	],
	'cite journal': [
		{ kind: 'author' },
		{ kind: 'param', name: 'title' },
		{ kind: 'param', name: 'journal' },
		{ kind: 'param', name: 'date' },
		{ kind: 'param', name: 'volume' },
		{ kind: 'param', name: 'issue' },
		{ kind: 'param', name: 'pages' },
		{ kind: 'param', name: 'doi' },
		{ kind: 'param', name: 'language' }
	],
	'cite av media': [
		{ kind: 'author' },
		{ kind: 'param', name: 'url' },
		{ kind: 'param', name: 'title' },
		{ kind: 'param', name: 'publisher' },
		{ kind: 'param', name: 'via' },
		{ kind: 'param', name: 'date' },
		{ kind: 'param', name: 'access-date' },
		{ kind: 'param', name: 'time' },
		{ kind: 'param', name: 'language' }
	],
	'cite video game': [
		{ kind: 'param', name: 'title' },
		{ kind: 'param', name: 'developer' },
		{ kind: 'param', name: 'publisher' },
		{ kind: 'param', name: 'platform' },
		{ kind: 'param', name: 'version' },
		{ kind: 'param', name: 'date' },
		{ kind: 'param', name: 'scene' },
		{ kind: 'param', name: 'level' },
		{ kind: 'param', name: 'language' }
	]
};

const LOCAL_PARAM_ALIASES: Record<string, string> = {
	accessdate: 'access-date',
	archivedate: 'archive-date',
	archiveurl: 'archive-url',
	deadurl: 'url-status',
	'dead-url': 'url-status',
	first1: 'first',
	last1: 'last',
	author1: 'author',
	'author-link1': 'author-link'
};

const LOCAL_CANONICAL_ALIASES: Record<string, string[]> = {
	'access-date': ['accessdate'],
	'archive-date': ['archivedate'],
	'archive-url': ['archiveurl'],
	'url-status': ['dead-url', 'deadurl'],
	first: ['first1'],
	last: ['last1'],
	author: ['author1'],
	'author-link': ['author-link1']
};

let mountedApp: VueApp | null = null;
let mountedRoot: unknown = null;
let currentInsertionTarget: InsertionTarget | null = null;
let rowCounter = 0;
let toolbarHookRegistered = false;
const registeredEditors = new WeakSet<HTMLTextAreaElement>();
const pendingToolbarRegistrations = new WeakMap<HTMLTextAreaElement, number>();

/**
 * Generate a unique row id for the insert-citation form.
 * @param prefix - Prefix describing the row kind.
 * @returns Stable per-session row id.
 */
function nextRowId(prefix: string): string {
	rowCounter += 1;
	return `${prefix}-${rowCounter}`;
}

/**
 * Normalize a citation template name for lookups.
 * @param name - Raw template name.
 * @returns Lowercased trimmed template name.
 */
function normalizeTemplateName(name: string): string {
	return name.trim().toLowerCase();
}

/**
 * Create an editable parameter field model.
 * @param name - Initial parameter name.
 * @param value - Initial parameter value.
 * @returns Parameter field object.
 */
function createField(name = '', value = ''): ParamField {
	return { name, value };
}

/**
 * Create a generic parameter row for the insert dialog.
 * @param name - Initial parameter name.
 * @param value - Initial parameter value.
 * @returns Parameter row model.
 */
export function createParamRow(name = '', value = ''): InsertCitationParamRow {
	return {
		id: nextRowId('param'),
		kind: 'param',
		field: createField(name, value)
	};
}

/**
 * Build the default parameter name for an indexed author field.
 * @param baseName - Base author parameter name.
 * @param index - 1-based author row index.
 * @returns Indexed author parameter name.
 */
function createIndexedAuthorFieldName(baseName: 'author' | 'author-link' | 'first' | 'last', index: number): string {
	return `${baseName}${index}`;
}

/**
 * Create an author row that supports split and combined author fields.
 * @param mode - Initial author-row mode.
 * @param index - 1-based author row index used for default parameter names.
 * @returns Author row model.
 */
export function createAuthorRow(mode: 'split' | 'single' = 'split', index = 1): InsertCitationAuthorRow {
	return {
		id: nextRowId('author'),
		kind: 'author',
		index,
		mode,
		split: {
			last: createField(createIndexedAuthorFieldName('last', index)),
			first: createField(createIndexedAuthorFieldName('first', index)),
			link: createField(createIndexedAuthorFieldName('author-link', index))
		},
		single: {
			author: createField(createIndexedAuthorFieldName('author', index)),
			link: createField(createIndexedAuthorFieldName('author-link', index))
		}
	};
}

/**
 * Reorder rows so author-specific rows stay grouped before generic parameters.
 * Preserves relative order within the author and parameter groups.
 * @param rows - Row models to reorder.
 * @returns Rows with authors first and parameters after them.
 */
function sortRowsAuthorFirst(rows: InsertCitationRow[]): InsertCitationRow[] {
	const authorRows: InsertCitationRow[] = [];
	const paramRows: InsertCitationRow[] = [];

	rows.forEach((row) => {
		if (row.kind === 'author') {
			authorRows.push(row);
			return;
		}
		paramRows.push(row);
	});

	return [...authorRows, ...paramRows];
}

/**
 * Compute the next 1-based author row index for the current form state.
 * @param rows - Existing dialog rows.
 * @returns Next available author index.
 */
function getNextAuthorRowIndex(rows: InsertCitationRow[]): number {
	let highestIndex = 0;

	rows.forEach((row) => {
		if (row.kind === 'author') {
			highestIndex = Math.max(highestIndex, row.index);
		}
	});

	return highestIndex + 1;
}

/**
 * Build the initial set of form rows for a citation template.
 * @param templateName - Citation template name.
 * @returns Ordered list of initial rows to render.
 */
export function createDefaultRowsForTemplate(templateName: string): InsertCitationRow[] {
	const specs = DEFAULT_TEMPLATE_ROWS[normalizeTemplateName(templateName)] ?? DEFAULT_TEMPLATE_ROWS['cite web'];
	let nextAuthorIndex = 1;
	return sortRowsAuthorFirst(
		specs.map((spec) => (spec.kind === 'author' ? createAuthorRow(spec.mode, nextAuthorIndex++) : createParamRow(spec.name)))
	);
}

/**
 * Merge split author fields into a single display string.
 * @param firstName - Author first name.
 * @param lastName - Author last name.
 * @returns Combined author name.
 */
function combineAuthorName(firstName: string, lastName: string): string {
	const first = firstName.trim();
	const last = lastName.trim();
	if (first && last) return `${first} ${last}`;
	return first || last;
}

/**
 * Split a combined author string into first and last name parts.
 * @param authorName - Combined author string.
 * @returns Parsed first and last name values.
 */
function splitAuthorName(authorName: string): { first: string; last: string } {
	const trimmed = authorName.trim();
	if (!trimmed) return { first: '', last: '' };

	if (trimmed.includes(',')) {
		const parts = trimmed.split(',');
		return {
			last: parts[0]?.trim() ?? '',
			first: parts.slice(1).join(',').trim()
		};
	}

	const parts = trimmed.split(/\s+/);
	if (parts.length === 1) {
		return { first: '', last: parts[0] };
	}

	return {
		first: parts.slice(0, -1).join(' '),
		last: parts[parts.length - 1] ?? ''
	};
}

/**
 * Switch an author row between split-name and single-name modes.
 * @param row - Author row to update.
 * @param useSingle - Whether the row should use the combined author field.
 */
export function toggleAuthorRowMode(row: InsertCitationAuthorRow, useSingle: boolean): void {
	if (useSingle && row.mode !== 'single') {
		row.single.author.value = combineAuthorName(row.split.first.value, row.split.last.value);
		row.single.link.name = row.split.link.name || row.single.link.name;
		row.single.link.value = row.split.link.value;
		row.mode = 'single';
		return;
	}

	if (!useSingle && row.mode !== 'split') {
		const parsed = splitAuthorName(row.single.author.value);
		row.split.first.value = parsed.first;
		row.split.last.value = parsed.last;
		row.split.link.name = row.single.link.name || row.split.link.name;
		row.split.link.value = row.single.link.value;
		row.mode = 'split';
	}
}

/**
 * Escape a ref name for safe inclusion in a quoted wikitext attribute.
 * @param refName - Raw ref name entered by the user.
 * @returns Escaped ref name value.
 */
function escapeRefNameAttribute(refName: string): string {
	return refName
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/**
 * Render the current citation form rows into inline ref-wrapped citation wikitext.
 * @param templateName - Citation template name.
 * @param refName - Optional ref name for the wrapping ref tag.
 * @param rows - Ordered row models from the dialog.
 * @returns Single-line ref snippet ready for insertion.
 */
export function buildCitationWikitext(templateName: string, refName: string, rows: InsertCitationRow[]): string {
	const parts = [`{{${templateName}`];

	/**
	 * Append a filled parameter field to the output.
	 * @param field - Parameter field to serialize.
	 */
	const pushField = (field: ParamField): void => {
		const name = field.name.trim();
		const value = field.value.trim();
		if (!name || !value) return;
		parts.push(`|${name}=${value}`);
	};

	rows.forEach((row) => {
		if (row.kind === 'param') {
			pushField(row.field);
			return;
		}

		if (row.mode === 'single') {
			pushField(row.single.author);
			pushField(row.single.link);
			return;
		}

		pushField(row.split.last);
		pushField(row.split.first);
		pushField(row.split.link);
	});

	parts.push('}}');
	const trimmedRefName = refName.trim();
	const refNameAttribute = trimmedRefName ? ` name="${escapeRefNameAttribute(trimmedRefName)}"` : '';
	return `<ref${refNameAttribute}>${parts.join(' ')}</ref>`;
}

/**
 * Locate the main wiki editor textarea on the page.
 * @returns The editor textarea or null if unavailable.
 */
function getEditorTextarea(): HTMLTextAreaElement | null {
	const textarea = document.getElementById('wpTextbox1');
	return textarea instanceof HTMLTextAreaElement ? textarea : null;
}

/**
 * Check whether a node is still attached to the current document.
 * @param node - Node to test.
 * @returns True when the node is present in the body.
 */
function isAttached(node: Node | null): boolean {
	return Boolean(node && document.body.contains(node));
}

/**
 * Snapshot the current insertion position of an editor textarea.
 * @param textarea - Target editor textarea.
 * @returns Captured insertion target or null if no textarea exists.
 */
export function captureInsertionTarget(textarea: HTMLTextAreaElement | null): InsertionTarget | null {
	if (!textarea) return null;
	return {
		textarea,
		selectionStart: textarea.selectionStart ?? textarea.value.length,
		selectionEnd: textarea.selectionEnd ?? textarea.value.length,
		scrollTop: textarea.scrollTop,
		scrollLeft: textarea.scrollLeft
	};
}

/**
 * Insert text into the editor selection.
 * Prefers MediaWiki's textSelection integration so CodeMirror-backed editors work,
 * and falls back to direct textarea replacement when that API is unavailable.
 * @param textarea - Target editor textarea.
 * @param text - Text to insert.
 * @param target - Optional captured selection and scroll state.
 */
export function insertTextAtSelection(textarea: HTMLTextAreaElement, text: string, target?: InsertionTarget | null): void {
	const globalScope = globalThis as {
		$?: (value: HTMLTextAreaElement) => JQuery & {
			textSelection?: (command: 'replaceSelection', value: string) => unknown;
		};
	};
	if (typeof globalScope.$ === 'function') {
		const $textarea = globalScope.$(textarea);
		if (typeof $textarea.textSelection === 'function') {
			$textarea.textSelection('replaceSelection', text);
			return;
		}
	}

	const selectionSource = target && target.textarea === textarea ? target : null;
	const start = selectionSource?.selectionStart ?? textarea.selectionStart ?? textarea.value.length;
	const end = selectionSource?.selectionEnd ?? textarea.selectionEnd ?? start;
	const before = textarea.value.slice(0, start);
	const after = textarea.value.slice(end);
	const nextValue = `${before}${text}${after}`;
	const caret = start + text.length;

	textarea.value = nextValue;
	textarea.focus();
	textarea.setSelectionRange(caret, caret);
	textarea.scrollTop = selectionSource?.scrollTop ?? textarea.scrollTop;
	textarea.scrollLeft = selectionSource?.scrollLeft ?? textarea.scrollLeft;
	textarea.dispatchEvent(new Event('input', { bubbles: true }));
	textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Add a normalized option to the autocomplete list if it is unique.
 * @param options - Output option list.
 * @param seen - Set of option values already emitted.
 * @param value - Candidate option value.
 */
function addOption(options: string[], seen: Set<string>, value?: string | null): void {
	const normalized = (value ?? '').trim().toLowerCase();
	if (!normalized || seen.has(normalized)) return;
	seen.add(normalized);
	options.push(normalized);
}

/**
 * Build the autocomplete option list for parameter names.
 * @param templateName - Citation template name.
 * @returns Ordered parameter-name suggestions.
 */
function resolveParamOptions(templateName: string): string[] {
	const normalizedTemplate = normalizeTemplateName(templateName);
	const order = getTemplateParamOrder(normalizedTemplate);
	const aliasMap = getTemplateAliasMap(normalizedTemplate);
	const defaults = DEFAULT_TEMPLATE_ROWS[normalizedTemplate] ?? DEFAULT_TEMPLATE_ROWS['cite web'];
	const options: string[] = [];
	const seen = new Set<string>();

	defaults.forEach((spec) => {
		if (spec.kind === 'param') {
			addOption(options, seen, spec.name);
			return;
		}
		addOption(options, seen, 'last1');
		addOption(options, seen, 'first1');
		addOption(options, seen, 'author-link1');
		addOption(options, seen, 'author1');
	});

	order.forEach((param) => {
		addOption(options, seen, param);
		(LOCAL_CANONICAL_ALIASES[param] ?? []).forEach((alias) => addOption(options, seen, alias));
	});

	Object.keys(aliasMap).forEach((alias) => addOption(options, seen, alias));
	Object.keys(LOCAL_PARAM_ALIASES).forEach((alias) => addOption(options, seen, alias));

	return options;
}

/**
 * Notify the user that no editable textarea is available.
 */
function notifyNoEditor(): void {
	mw.notify?.(t('ui.insertCitation.dialog.noEditor'), {
		type: 'warn',
		title: 'Cite Forge'
	});
}

/**
 * Check whether a mounted Vue root exposes the insert-dialog API.
 * @param value - Mounted root instance.
 * @returns True when the value is an insert-citation root.
 */
function isInsertCitationRoot(value: unknown): value is InsertCitationRoot {
	return Boolean(value && typeof (value as InsertCitationRoot).openDialog === 'function');
}

/**
 * Resolve the editor textarea from a WikiEditor callback context.
 * @param context - WikiEditor callback payload.
 * @returns Matching textarea or the main editor fallback.
 */
function extractTextareaFromContext(context?: JQuery | WikiEditorContext): HTMLTextAreaElement | null {
	if (context && typeof (context as JQuery).get === 'function') {
		const node = (context as JQuery).get(0);
		return node instanceof HTMLTextAreaElement ? node : getEditorTextarea();
	}

	const maybeContext = context as WikiEditorContext | undefined;
	if (maybeContext?.textarea instanceof HTMLTextAreaElement) {
		return maybeContext.textarea;
	}
	const node = maybeContext?.$textarea?.get?.(0);
	return node instanceof HTMLTextAreaElement ? node : getEditorTextarea();
}

/**
 * Build the WikiEditor dropdown configuration for citation templates.
 * @returns Toolbar tool configuration object.
 */
function buildToolbarToolConfig(): {
	label: string;
	type: 'select';
	icon: string;
	list: Record<string, { label: string; action: { type: 'callback'; execute: (context?: JQuery | WikiEditorContext) => void } }>;
} {
	const list = SUPPORTED_INSERT_CITATION_TEMPLATES.reduce<Record<string, { label: string; action: { type: 'callback'; execute: (context?: JQuery | WikiEditorContext) => void } }>>(
		(acc, templateName) => {
			acc[normalizeTemplateName(templateName).replace(/\s+/g, '-')] = {
				label: templateName,
				action: {
					type: 'callback',
					execute: (context?: JQuery | WikiEditorContext) => {
						const textarea = extractTextareaFromContext(context);
						void openInsertCitationDialog(templateName, captureInsertionTarget(textarea));
					}
				}
			};
			return acc;
		},
		{}
	);

	return {
		label: t('ui.insertCitation.toolbar.toolLabel'),
		type: 'select',
		icon: TOOLBAR_ICON,
		list
	};
}

/**
 * Add the insert-citation dropdown to a specific WikiEditor toolbar section.
 * @param $textarea - jQuery-wrapped editor textarea.
 * @param section - Toolbar section name.
 * @returns True when the tool was registered successfully.
 */
function tryAddToolbarSelect($textarea: JQuery, section: string): boolean {
	const wikiEditor = ($textarea as JQuery & { wikiEditor?: (command: string, config: unknown) => void }).wikiEditor;
	if (typeof wikiEditor !== 'function') return false;

	const groupName = 'citeforge';
	const groupLabel = 'Cite Forge';
	const toolConfig = buildToolbarToolConfig();

	try {
		wikiEditor.call($textarea, 'addToToolbar', {
			section,
			groups: {
				[groupName]: {
					label: groupLabel
				}
			}
		});
		wikiEditor.call($textarea, 'addToToolbar', {
			section,
			group: groupName,
			tools: {
				[TOOL_NAME]: toolConfig
			}
		});
		return true;
	} catch (error) {
		console.warn('[Cite Forge] Failed to add insert citation dropdown', { section, error });
		return false;
	}
}

/**
 * Register the insert-citation dropdown on a textarea once.
 * @param textarea - Editor textarea to enhance.
 */
function registerInsertCitationToolbar(textarea: HTMLTextAreaElement): void {
	if (registeredEditors.has(textarea)) return;
	const $textarea = $(textarea);
	if (!$textarea.length) return;
	console.log('[Cite Forge] Attempting to register insert citation dropdown on textarea', { textarea });

	const added = tryAddToolbarSelect($textarea, 'cites') || tryAddToolbarSelect($textarea, 'main');
	if (added) {
		registeredEditors.add(textarea);
	} else {
		console.warn('[Cite Forge] Failed to register insert citation dropdown on textarea', { textarea });
	}
}

/**
 * Schedule delayed toolbar registration after WikiEditor reports readiness.
 * @param textarea - Editor textarea to enhance.
 */
function scheduleInsertCitationToolbarRegistration(textarea: HTMLTextAreaElement): void {
	if (registeredEditors.has(textarea) || pendingToolbarRegistrations.has(textarea)) return;

	const timeoutId = window.setTimeout(() => {
		pendingToolbarRegistrations.delete(textarea);
		registerInsertCitationToolbar(textarea);
	}, TOOLBAR_READY_DELAY_MS);

	pendingToolbarRegistrations.set(textarea, timeoutId);
}

/**
 * Initialize the WikiEditor insert-citation dropdown for edit pages.
 */
export function initInsertCitationToolbar(): void {
	const action = mw.config.get('wgAction');
	if (action !== 'edit' && action !== 'submit') return;
	if (toolbarHookRegistered) {
		console.warn('[Cite Forge] wikiEditor.toolbarReady hook already registered, skipping duplicate registration');
		return;
	}
	toolbarHookRegistered = true;

	mw.hook('wikiEditor.toolbarReady').add((context?: JQuery | WikiEditorContext) => {
		console.log('[Cite Forge] wikiEditor.toolbarReady hook fired, attempting to register insert citation dropdown', { context });
		const target = extractTextareaFromContext(context);
		if (target) {
			scheduleInsertCitationToolbarRegistration(target);
		} else {
			console.warn('[Cite Forge] wikiEditor.toolbarReady hook fired but no textarea was found in the context', { context });
		}
	});
}

/**
 * Open the insert-citation dialog for a specific citation template.
 * @param templateName - Citation template name to initialize with.
 * @param target - Optional captured insertion target for the current cursor position.
 * @returns Promise that resolves once the dialog is mounted or updated.
 */
export async function openInsertCitationDialog(templateName: string, target?: InsertionTarget | null): Promise<void> {
	ensureStyleElement(STYLE_ID, styles);
	ensureMount(MOUNT_ID);
	currentInsertionTarget = target ?? captureInsertionTarget(getEditorTextarea());

	if (mountedApp && isInsertCitationRoot(mountedRoot)) {
		mountedRoot.openDialog(templateName, currentInsertionTarget);
		return;
	}

	const { Vue, Codex } = await loadCodexAndVue();

	const appOptions = {
		/**
		 * Create the initial reactive state for the insert-citation dialog.
		 * @returns Initial dialog state.
		 */
		data(): InsertCitationState {
			return {
				open: true,
				templateName,
				refName: '',
				rows: createDefaultRowsForTemplate(templateName),
				allParamOptions: resolveParamOptions(templateName),
				loadingParams: true,
				dialogName: DIALOG_NAME,
				paramDatalistId: `${DIALOG_NAME}-params`,
				requestToken: 0
			};
		},
		methods: {
			/**
			 * Reopen the mounted dialog for another template and cursor target.
			 * @param nextTemplateName - Citation template to display.
			 * @param targetState - Captured insertion target.
			 */
			openDialog(this: InsertCitationVm, nextTemplateName: string, targetState: InsertionTarget | null): void {
				currentInsertionTarget = targetState ?? captureInsertionTarget(getEditorTextarea());
				this.templateName = nextTemplateName;
				this.refName = '';
				this.rows = createDefaultRowsForTemplate(nextTemplateName);
				this.allParamOptions = resolveParamOptions(nextTemplateName);
				this.open = true;
				void this.loadTemplateParams(nextTemplateName);
			},
			/**
			 * Close the insert-citation dialog.
			 */
			closeDialog(this: InsertCitationVm): void {
				this.open = false;
			},
			/**
			 * Load TemplateData-backed parameter suggestions for the current template.
			 * @param nextTemplateName - Citation template whose parameters should be loaded.
			 * @returns Promise that resolves after the latest request finishes.
			 */
			async loadTemplateParams(this: InsertCitationVm, nextTemplateName: string): Promise<void> {
				const requestToken = ++this.requestToken;
				this.loadingParams = true;
				this.allParamOptions = resolveParamOptions(nextTemplateName);
				try {
					await fetchTemplateDataOrder(nextTemplateName);
				} finally {
					if (requestToken !== this.requestToken) return;
					this.allParamOptions = resolveParamOptions(nextTemplateName);
					this.loadingParams = false;
				}
			},
			/**
			 * Append a new blank parameter row.
			 */
			addParamRow(this: InsertCitationVm): void {
				this.rows = [...this.rows, createParamRow()];
			},
			/**
			 * Append a new author row for name-specific fields.
			 */
			addNameRow(this: InsertCitationVm): void {
				this.rows = sortRowsAuthorFirst([...this.rows, createAuthorRow('split', getNextAuthorRowIndex(this.rows))]);
			},
			/**
			 * Remove a parameter or author row from the form.
			 * @param rowId - Row id to remove.
			 */
			removeRow(this: InsertCitationVm, rowId: string): void {
				this.rows = this.rows.filter((row) => row.id !== rowId);
			},
			/**
			 * Toggle an author row between split and single-field modes.
			 * @param this - Vue instance reference.
			 * @param row - Author row to update.
			 * @param useSingle - Whether the row should use combined author mode.
			 */
			setAuthorMode(this: InsertCitationVm, row: InsertCitationAuthorRow, useSingle: boolean): void {
				toggleAuthorRowMode(row, useSingle);
			},
			/**
			 * Serialize the form and insert the resulting citation at the current cursor position.
			 */
			insertCitation(this: InsertCitationVm): void {
				const targetState = currentInsertionTarget;
				const fallbackTextarea = getEditorTextarea();
				const textarea = targetState && isAttached(targetState.textarea) ? targetState.textarea : fallbackTextarea;
				if (!textarea) {
					notifyNoEditor();
					return;
				}

				const snippet = buildCitationWikitext(this.templateName, this.refName, this.rows);
				insertTextAtSelection(textarea, snippet, targetState && targetState.textarea === textarea ? targetState : captureInsertionTarget(textarea));
				currentInsertionTarget = captureInsertionTarget(textarea);
				this.open = false;
			},
			/**
			 * Translate a message key for the dialog template.
			 * @param key - Message key.
			 * @param params - Optional message parameters.
			 * @returns Localized message string.
			 */
			t(key: MessageKey, params?: MessageParams): string {
				return t(key, params);
			}
		},
		/**
		 * Prime TemplateData suggestions when the dialog instance is created.
		 * @param this - Vue instance.
		 */
		created(this: InsertCitationVm) {
			void this.loadTemplateParams(this.templateName);
		},
		template: TEMPLATE
	};

	const app = (Vue as VueModule).createMwApp(appOptions);
	registerCodexComponents(app, Codex);
	mountedApp = app;
	mountedRoot = app.mount(`#${MOUNT_ID}`);
}
