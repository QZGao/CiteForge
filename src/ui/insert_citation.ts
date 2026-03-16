import {
	fetchTemplateDataCitoidMap,
	fetchTemplateDataOrder,
	getTemplateAliasMap,
	getTemplateParamOrder,
	type TemplateCitoidMap
} from '../data/templatedata_fetch';
import { fetchCitoidData, type CitoidDataObject } from '../data/citoid';
import { MessageKey, MessageParams, t } from '../i18n';
import { ensureMount, ensureStyleElement, loadCodexAndVue, registerCodexComponents } from './codex';
import styles from './insert_citation.css';
import TEMPLATE from './insert_citation.template.vue';

type VueModule = { createMwApp: (options: unknown) => VueApp };
type VueApp = { mount: (selector: string) => unknown; component?: (name: string, value: unknown) => VueApp };

type DefaultRowSpec = { kind: 'param'; name: string } | { kind: 'author'; mode?: 'split' | 'single' };
type AuthorValueKey = 'author' | 'first' | 'last' | 'link';
type AutoFillQueryResult = {
	query: string;
	sourceParam: string;
};
type MappedCitoidParams = Record<string, string>;

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
	autoFilling: boolean;
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
	autoFillFromCitoid: () => Promise<void>;
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
const TOOLBAR_READY_DELAY_MS = 2000;
const AUTO_FILL_SOURCE_PARAMS = ['url', 'doi', 'isbn', 'pmid', 'pmc', 'arxiv', 'jstor', 'oclc'] as const;
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
		{ kind: 'param', name: 'url' },
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
 * Format the current local date as yyyy-mm-dd for citation fields.
 * @param date - Date to format.
 * @returns Local calendar date in yyyy-mm-dd format.
 */
function formatDateYyyyMmDd(date: Date): string {
	const year = String(date.getFullYear());
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/**
 * Get the default startup value for a parameter row when one is needed.
 * @param name - Parameter name.
 * @returns Prefilled parameter value.
 */
function getDefaultParamValue(name: string): string {
	return name === 'access-date' ? formatDateYyyyMmDd(new Date()) : '';
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

	authorRows.sort((left, right) => {
		if (left.kind !== 'author' || right.kind !== 'author') return 0;
		return left.index - right.index;
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
		specs.map((spec) =>
			spec.kind === 'author'
				? createAuthorRow(spec.mode, nextAuthorIndex++)
				: createParamRow(spec.name, getDefaultParamValue(spec.name))
		)
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
	return `<ref${refNameAttribute}>${parts.join('')}</ref>`;
}

/**
 * Clone a single row model so autofill can return a fresh array for Vue reactivity.
 * @param row - Row model to duplicate.
 * @returns Cloned row model.
 */
function cloneRow(row: InsertCitationRow): InsertCitationRow {
	if (row.kind === 'param') {
		return {
			...row,
			field: { ...row.field }
		};
	}

	return {
		...row,
		split: {
			last: { ...row.split.last },
			first: { ...row.split.first },
			link: { ...row.split.link }
		},
		single: {
			author: { ...row.single.author },
			link: { ...row.single.link }
		}
	};
}

/**
 * Normalize a parameter name to its canonical TemplateData parameter.
 * @param templateName - Citation template name.
 * @param paramName - Raw parameter name.
 * @returns Canonical lowercased parameter name.
 */
function normalizeParamNameForTemplate(templateName: string, paramName: string): string {
	const normalizedName = paramName.trim().toLowerCase();
	if (!normalizedName) return '';

	const aliasMap = getTemplateAliasMap(templateName);
	const localCanonical = LOCAL_PARAM_ALIASES[normalizedName] ?? normalizedName;
	return aliasMap[normalizedName] ?? aliasMap[localCanonical] ?? localCanonical;
}

/**
 * Check whether a value is a plain object with string keys.
 * @param value - Candidate value.
 * @returns True when the value is an object record.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Convert an unknown error into a log-friendly object.
 * @param error - Thrown error value.
 * @returns Error details suitable for console logging.
 */
function describeError(error: unknown): Record<string, unknown> {
	if (!isRecord(error)) {
		return { value: error };
	}

	return {
		name: error instanceof Error ? error.name : undefined,
		message: error instanceof Error ? error.message : undefined,
		...error
	};
}

/**
 * Convert a Citoid value into plain text suitable for a citation parameter.
 * @param value - Raw Citoid value.
 * @returns Flattened string value.
 */
function stringifyCitoidValue(value: unknown): string {
	if (typeof value === 'string') {
		return value.trim();
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	if (Array.isArray(value)) {
		return value
			.map((item) => {
				if (Array.isArray(item)) {
					return item.map((part) => stringifyCitoidValue(part)).filter(Boolean).join(', ');
				}
				return stringifyCitoidValue(item);
			})
			.filter(Boolean)
			.join('; ');
	}

	return '';
}

/**
 * Recursively apply a TemplateData Citoid map to a Citoid response object.
 * @param output - Parameter map being built.
 * @param source - Current Citoid source value.
 * @param map - Current TemplateData Citoid map value.
 */
function applyCitoidMapValue(output: MappedCitoidParams, source: unknown, map: unknown): void {
	if (source === undefined || map === undefined || map === null) return;

	if (typeof map === 'string') {
		const value = stringifyCitoidValue(source);
		const paramName = map.trim().toLowerCase();
		if (paramName && value) {
			output[paramName] = value;
		}
		return;
	}

	if (Array.isArray(map)) {
		if (!Array.isArray(source)) return;
		map.forEach((childMap, index) => {
			applyCitoidMapValue(output, source[index], childMap);
		});
		return;
	}

	if (!isRecord(map) || !isRecord(source)) return;

	Object.entries(map).forEach(([key, childMap]) => {
		applyCitoidMapValue(output, source[key], childMap);
	});
}

/**
 * Convert a Citoid response into template parameters using TemplateData's map.
 * @param citoidData - Raw Citoid response item.
 * @param citoidMap - TemplateData Citoid map for the selected template.
 * @returns Canonical parameter/value pairs.
 */
export function mapCitoidDataToParams(citoidData: CitoidDataObject, citoidMap: TemplateCitoidMap): MappedCitoidParams {
	const mapped: MappedCitoidParams = {};
	applyCitoidMapValue(mapped, citoidData, citoidMap);
	return mapped;
}

/**
 * Collect the top-level Citoid source keys that TemplateData explicitly maps.
 * @param citoidMap - TemplateData Citoid map.
 * @returns Top-level Citoid keys mentioned in the map.
 */
function getMappedCitoidSourceKeys(citoidMap: TemplateCitoidMap | null): Set<string> {
	if (!citoidMap || !isRecord(citoidMap)) return new Set();
	return new Set(Object.keys(citoidMap));
}

/**
 * Collect mapped template parameter names from a nested TemplateData Citoid map value.
 * @param mapValue - Map value to inspect.
 * @param output - Ordered list of mapped param names.
 * @param seen - Set of param names already emitted.
 */
function collectMappedTemplateParams(mapValue: unknown, output: string[], seen: Set<string>): void {
	if (typeof mapValue === 'string') {
		const normalized = mapValue.trim().toLowerCase();
		if (!normalized || seen.has(normalized)) return;
		seen.add(normalized);
		output.push(normalized);
		return;
	}

	if (Array.isArray(mapValue)) {
		mapValue.forEach((child) => collectMappedTemplateParams(child, output, seen));
		return;
	}

	if (!isRecord(mapValue)) return;

	Object.values(mapValue).forEach((child) => {
		collectMappedTemplateParams(child, output, seen);
	});
}

/**
 * Collect supplemental template params that other TemplateData Citoid maps use
 * for the same top-level Citoid source key.
 * @param sourceKey - Top-level Citoid source field name.
 * @param citoidMaps - TemplateData Citoid maps from other citation templates.
 * @returns Ordered mapped param names discovered in the provided maps.
 */
function getSupplementalTemplateParamsForCitoidKey(
	sourceKey: string,
	citoidMaps: Array<TemplateCitoidMap | null>
): string[] {
	const output: string[] = [];
	const seen = new Set<string>();

	citoidMaps.forEach((citoidMap) => {
		if (!citoidMap || !isRecord(citoidMap)) return;
		collectMappedTemplateParams(citoidMap[sourceKey], output, seen);
	});

	return output;
}

/**
 * Add direct param fills for top-level Citoid fields that are not explicitly
 * covered by TemplateData's Citoid map, but whose normalized names are already
 * supported by the selected template.
 * @param templateName - Citation template name.
 * @param citoidData - Raw Citoid response item.
 * @param mappedParams - Parameters already mapped via TemplateData.
 * @param citoidMap - TemplateData Citoid map for the selected template.
 * @param supportedParams - Canonical parameter names supported by the template.
 * @returns Parameter map including directly fillable unmapped fields.
 */
export function applyUnmappedCitoidParams(
	templateName: string,
	citoidData: CitoidDataObject,
	mappedParams: MappedCitoidParams,
	citoidMap: TemplateCitoidMap | null,
	supplementalCitoidMaps: Array<TemplateCitoidMap | null>,
	supportedParams: Iterable<string>
): MappedCitoidParams {
	const supported = new Set(Array.from(supportedParams, (param) => param.trim().toLowerCase()).filter(Boolean));
	const explicitlyMappedKeys = getMappedCitoidSourceKeys(citoidMap);
	const merged = { ...mappedParams };

	Object.entries(citoidData).forEach(([sourceKey, value]) => {
		if (explicitlyMappedKeys.has(sourceKey)) return;

		const candidateParams = [
			normalizeParamNameForTemplate(templateName, sourceKey),
			...getSupplementalTemplateParamsForCitoidKey(sourceKey, supplementalCitoidMaps).map((paramName) =>
				normalizeParamNameForTemplate(templateName, paramName)
			)
		];
		const canonicalParam = candidateParams.find((paramName) => supported.has(paramName) && !merged[paramName]);
		if (!canonicalParam) return;

		const stringValue = stringifyCitoidValue(value);
		if (!stringValue) return;

		merged[canonicalParam] = stringValue;
	});

	return merged;
}

/**
 * Parse an author-related parameter name into its row index and field kind.
 * @param paramName - Canonical parameter name.
 * @returns Parsed author field metadata, or null for non-author params.
 */
function parseAuthorParamName(paramName: string): { field: AuthorValueKey; index: number } | null {
	const match = /^(author-link|author|first|last)(\d*)$/.exec(paramName.trim().toLowerCase());
	if (!match) return null;

	const [, baseName, suffix] = match;
	const field: AuthorValueKey = baseName === 'author-link' ? 'link' : (baseName as Exclude<AuthorValueKey, 'link'>);
	return {
		field,
		index: suffix ? Number.parseInt(suffix, 10) : 1
	};
}

/**
 * Find the best existing identifier or URL to use for Citoid lookup.
 * @param templateName - Citation template name.
 * @param rows - Current dialog rows.
 * @returns Query data for Citoid, or null when no supported source field is filled.
 */
export function findAutoFillQuery(templateName: string, rows: InsertCitationRow[]): AutoFillQueryResult | null {
	for (const sourceParam of AUTO_FILL_SOURCE_PARAMS) {
		const match = rows.find((row): row is InsertCitationParamRow => {
			if (row.kind !== 'param') return false;
			if (!row.field.value.trim()) return false;
			return normalizeParamNameForTemplate(templateName, row.field.name) === sourceParam;
		});

		if (match) {
			return {
				query: match.field.value.trim(),
				sourceParam
			};
		}
	}

	return null;
}

/**
 * Ensure an author row exists for a specific author index.
 * @param rows - Current row models.
 * @param index - 1-based author index.
 * @returns Existing or newly created author row.
 */
function getOrCreateAuthorRow(rows: InsertCitationRow[], index: number): InsertCitationAuthorRow {
	const existingRow = rows.find((row): row is InsertCitationAuthorRow => row.kind === 'author' && row.index === index);
	if (existingRow) return existingRow;

	const nextRow = createAuthorRow('split', index);
	rows.push(nextRow);
	return nextRow;
}

/**
 * Apply mapped Citoid values to a specific author row.
 * @param row - Author row to update.
 * @param values - Author field values grouped by index.
 */
function applyAuthorValues(row: InsertCitationAuthorRow, values: Partial<Record<AuthorValueKey, string>>): void {
	if (row.mode === 'single') {
		const currentNames = splitAuthorName(row.single.author.value);
		const nextAuthor =
			values.author ??
			combineAuthorName(values.first ?? currentNames.first, values.last ?? currentNames.last);
		if (values.author !== undefined || values.first !== undefined || values.last !== undefined) {
			row.single.author.value = nextAuthor;
		}
		if (values.link !== undefined) {
			row.single.link.value = values.link;
		}
		return;
	}

	if (values.author !== undefined && values.first === undefined && values.last === undefined) {
		const parsedName = splitAuthorName(values.author);
		row.split.first.value = parsedName.first;
		row.split.last.value = parsedName.last;
	}
	if (values.first !== undefined) {
		row.split.first.value = values.first;
	}
	if (values.last !== undefined) {
		row.split.last.value = values.last;
	}
	if (values.link !== undefined) {
		row.split.link.value = values.link;
	}
}

/**
 * Apply mapped Citoid parameter values to the current dialog rows.
 * @param templateName - Citation template name.
 * @param rows - Current dialog rows.
 * @param mappedParams - Canonical parameter/value pairs from Citoid.
 * @returns Updated row models.
 */
export function applyCitoidMappedParams(templateName: string, rows: InsertCitationRow[], mappedParams: MappedCitoidParams): InsertCitationRow[] {
	const nextRows = rows.map((row) => cloneRow(row));
	const authorValues = new Map<number, Partial<Record<AuthorValueKey, string>>>();
	const genericParams = Object.entries(mappedParams).filter(([paramName, value]) => {
		const authorField = parseAuthorParamName(paramName);
		if (!authorField || !value) return Boolean(value);

		const existingValues = authorValues.get(authorField.index) ?? {};
		existingValues[authorField.field] = value;
		authorValues.set(authorField.index, existingValues);
		return false;
	});

	authorValues.forEach((values, index) => {
		applyAuthorValues(getOrCreateAuthorRow(nextRows, index), values);
	});

	genericParams.forEach(([canonicalName, value]) => {
		if (!value) return;

		const matchingRow = nextRows.find((row): row is InsertCitationParamRow => {
			if (row.kind !== 'param') return false;
			return normalizeParamNameForTemplate(templateName, row.field.name) === canonicalName;
		});
		if (matchingRow) {
			matchingRow.field.value = value;
			return;
		}

		const blankRow = nextRows.find(
			(row): row is InsertCitationParamRow =>
				row.kind === 'param' && !row.field.name.trim() && !row.field.value.trim()
		);
		if (blankRow) {
			blankRow.field.name = canonicalName;
			blankRow.field.value = value;
			return;
		}

		nextRows.push(createParamRow(canonicalName, value));
	});

	return sortRowsAuthorFirst(nextRows);
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
 * Resolve the canonical parameter names supported by the selected template.
 * @param templateName - Citation template name.
 * @returns Canonical supported parameter names.
 */
function getSupportedTemplateParams(templateName: string): Set<string> {
	const supported = new Set<string>();
	resolveParamOptions(templateName).forEach((paramName) => {
		supported.add(normalizeParamNameForTemplate(templateName, paramName));
	});
	return supported;
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
				autoFilling: false,
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
				this.autoFilling = false;
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
			 * Populate citation fields from Citoid using the current URL or identifier field.
			 * @returns Promise that resolves after autofill finishes or fails.
			 */
			async autoFillFromCitoid(this: InsertCitationVm): Promise<void> {
				const query = findAutoFillQuery(this.templateName, this.rows);
				if (!query) {
					mw.notify?.(t('ui.insertCitation.dialog.autoFillNeedsSource'), {
						type: 'warn',
						title: 'Cite Forge'
					});
					return;
				}

				this.autoFilling = true;
				try {
					const normalizedTemplateName = normalizeTemplateName(this.templateName);
					const supplementalMapPromises = SUPPORTED_INSERT_CITATION_TEMPLATES
						.map((templateName) => normalizeTemplateName(templateName))
						.filter((templateName) => templateName !== normalizedTemplateName)
						.map((templateName) => fetchTemplateDataCitoidMap(templateName));

					const [citoidData, citoidMap, supplementalCitoidMaps] = await Promise.all([
						fetchCitoidData(query.query),
						fetchTemplateDataCitoidMap(this.templateName),
						Promise.all([fetchTemplateDataOrder(this.templateName), ...supplementalMapPromises]).then(
							([, ...maps]) => maps
						)
					]);

					const mappedParams = applyUnmappedCitoidParams(
						this.templateName,
						citoidData,
						citoidMap ? mapCitoidDataToParams(citoidData, citoidMap) : {},
						citoidMap,
						supplementalCitoidMaps,
						getSupportedTemplateParams(this.templateName)
					);
					if (Object.keys(mappedParams).length === 0) {
						mw.notify?.(t('ui.insertCitation.dialog.autoFillUnavailable'), {
							type: 'warn',
							title: 'Cite Forge'
						});
						return;
					}

					this.rows = applyCitoidMappedParams(this.templateName, this.rows, mappedParams);
				} catch (error) {
					console.warn('[Cite Forge] Failed to auto-fill citation from Citoid', {
						error: describeError(error),
						query,
						templateName: this.templateName
					});
					mw.notify?.(t('ui.insertCitation.dialog.autoFillFailed'), {
						type: 'error',
						title: 'Cite Forge'
					});
				} finally {
					this.autoFilling = false;
				}
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
