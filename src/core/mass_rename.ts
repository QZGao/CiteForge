import { Reference } from '../types';
import { pickTemplateParams, parseTemplateParams } from './parse_wikitext';
import {
	convertDigitsToAscii,
	domainFromUrl,
	domainShortFromUrl,
	extractUrl,
	firstYearCandidate,
	MONTH_NAME_MAP,
	normalizeNameKey,
	stripMarkup,
	toLatin
} from './string_utils';

export type NamingField =
	| 'last'
	| 'first'
	| 'author'
	| 'title'
	| 'work'
	| 'publisher'
	| 'domain'
	| 'domainShort'
	| 'phrase'
	| 'year'
	| 'fulldate';

export type IncrementStyle = 'latin' | 'numeric';

export interface RefMetadata {
	last?: string;
	first?: string;
	author?: string;
	title?: string;
	work?: string;
	publisher?: string;
	domain?: string;
	domainShort?: string;
	phrase?: string;
	year?: string;
	yearAscii?: string;
	textYear?: string;
	textYearAscii?: string;
	dateYMD?: string;
	dateDisplay?: string;
}

export interface MassRenameConfig {
	fields: NamingField[];
	lowercase: boolean;
	stripDiacritics: boolean;
	stripPunctuation: boolean;
	replaceSpaceWith: string;
	convertYearDigits: boolean;
	delimiter: string;
	delimiterConditional: boolean;
	incrementStyle: IncrementStyle;
}

export const NAMING_FIELDS: readonly NamingField[] = [
	'last',
	'first',
	'author',
	'title',
	'work',
	'publisher',
	'domain',
	'domainShort',
	'phrase',
	'year',
	'fulldate'
];

export const DEFAULT_FIELDS: NamingField[] = ['domainShort', 'fulldate'];

export const DEFAULT_CONFIG: MassRenameConfig = {
	fields: DEFAULT_FIELDS,
	lowercase: true,
	stripDiacritics: false,
	stripPunctuation: false,
	replaceSpaceWith: '_',
	convertYearDigits: true,
	delimiter: '-',
	delimiterConditional: false,
	incrementStyle: 'latin'
};

/**
 * Create a default mass rename configuration.
 */
export function createDefaultConfig(): MassRenameConfig {
	return { ...DEFAULT_CONFIG, fields: [...DEFAULT_FIELDS] };
}

/**
 * Normalize and filter a selection of naming fields.
 * @param selection - Raw field selection.
 * @param allowed - Allowed fields.
 * @returns Normalized field list.
 */
export function normalizeFieldSelection(
	selection: NamingField[],
	allowed: readonly NamingField[] = NAMING_FIELDS
): NamingField[] {
	const allowedSet = new Set(allowed);
	const seen = new Set<NamingField>();
	const result: NamingField[] = [];
	selection.forEach((field) => {
		if (!allowedSet.has(field) || seen.has(field)) return;
		seen.add(field);
		result.push(field);
	});
	return result;
}

/**
 * Strip language prefix from a string.
 * @param value - Input string.
 * @returns String without language prefix.
 */
function stripLanguagePrefix(value: string): string {
	return (value || '').replace(/^[a-zA-Z-]{2,}:\s*/, '');
}

type ParsedDate = { dateYMD?: string; dateDisplay?: string };

/**
 * Parse and normalize a date string.
 * @param value - Input date string.
 * @returns Parsed date components.
 */
function parseNormalizedDate(value: string): ParsedDate {
	const trimmed = value.trim();
	if (!trimmed) return {};
	const pad = (n: number) => n.toString().padStart(2, '0');
	const makeDate = (year: number, month: number, day: number): ParsedDate => {
		const dateYMD = `${year}${pad(month)}${pad(day)}`;
		if (typeof Date.prototype.toLocaleDateString === 'function') {
			const d = new Date(Date.UTC(year, month - 1, day));
			return { dateYMD, dateDisplay: d.toLocaleDateString(undefined, { timeZone: 'UTC' }) };
		}
		return { dateYMD, dateDisplay: `${year}-${pad(month)}-${pad(day)}` };
	};

	const numericMatch = trimmed.match(/^(\d{4})(?:\D+(\d{1,2})(?:\D+(\d{1,2}))?)?$/);
	if (numericMatch) {
		const [, y, m, d] = numericMatch;
		if (y && m && d) {
			return makeDate(Number(y), Number(m), Number(d));
		}
		if (y && m) {
			return { dateYMD: `${y}${pad(Number(m))}01`, dateDisplay: `${y}-${pad(Number(m))}` };
		}
		if (y) {
			return { dateYMD: y, dateDisplay: y };
		}
	}

	const dayMonth = trimmed.match(/^(\d{1,2})\s+([a-zA-Z.]+)\s*,?\s*(\d{4})$/);
	if (dayMonth) {
		const [, dayRaw, monthRaw, yearRaw] = dayMonth;
		const key = monthRaw.replace(/[^a-zA-Z]/g, '').toLowerCase();
		const month = MONTH_NAME_MAP.get(key) ?? MONTH_NAME_MAP.get(key.slice(0, 3));
		if (month) {
			return makeDate(Number(yearRaw), month, Number(dayRaw));
		}
	}
	const monthDay = trimmed.match(/^([a-zA-Z.]+)\s+(\d{1,2})(?:\s*,\s*|\s+)(\d{4})$/);
	if (monthDay) {
		const [, monthRaw, dayRaw, yearRaw] = monthDay;
		const key = monthRaw.replace(/[^a-zA-Z]/g, '').toLowerCase();
		const month = MONTH_NAME_MAP.get(key) ?? MONTH_NAME_MAP.get(key.slice(0, 3));
		if (month) {
			return makeDate(Number(yearRaw), month, Number(dayRaw));
		}
	}

	const parsed = Date.parse(trimmed);
	if (!Number.isNaN(parsed)) {
		const d = new Date(parsed);
		return {
			dateYMD: `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`,
			dateDisplay:
				typeof d.toLocaleDateString === 'function'
					? d.toLocaleDateString(undefined, { timeZone: 'UTC' })
					: trimmed
		};
	}

	return {};
}

/**
 * Extract reference metadata from content.
 * @param ref - Reference object.
 * @param providedContent - Optional content override.
 * @returns Extracted metadata.
 */
export function extractMetadata(ref: Reference, providedContent?: string): RefMetadata {
	const content = providedContent ?? ref.contentWikitext ?? '';
	const params = parseTemplateParams(content);
	const meta: RefMetadata = {};

	const templateName = (() => {
		const match = content.match(/\{\{\s*([^{|}]+?)(?:\s*\||\s*}})/);
		if (!match) return null;
		return match[1].replace(/_/g, ' ').trim().toLowerCase();
	})();

	const pick = (...keys: string[]): string | undefined => pickTemplateParams(params, ...keys);
	meta.last = pick('last', 'last1', 'surname', 'author1');
	meta.first = pick('first', 'first1', 'given');
	meta.author = pick('author', 'authors');
	const titleRaw = pick('title', 'script-title', 'chapter', 'contribution');
	meta.title = stripMarkup(stripLanguagePrefix(titleRaw || ''));
	meta.work = stripMarkup(pick('work', 'journal', 'newspaper', 'website', 'periodical') || '');
	meta.publisher = stripMarkup(pick('publisher', 'institution') || '');

	// Extract and normalize domain
	const url = pick('url', 'archive-url') || extractUrl(content);
	if (url) {
		meta.domain = domainFromUrl(url) || undefined;
		const shortDomain = domainShortFromUrl(url);
		meta.domainShort = typeof shortDomain === 'string' ? shortDomain : undefined;
	}

	// Extract and normalize date
	const rawDate = pick('date');
	const normalizedDate = rawDate ? convertDigitsToAscii(stripMarkup(rawDate)) : '';
	if (normalizedDate) {
		const parsed = parseNormalizedDate(normalizedDate);
		meta.dateYMD = parsed.dateYMD;
		meta.dateDisplay = parsed.dateDisplay;
	}

	// Extract year
	const baseYear = firstYearCandidate(pick('year', 'date') || rawDate || '');
	if (baseYear) {
		meta.year = baseYear.original;
		if (baseYear.ascii !== baseYear.original) meta.yearAscii = baseYear.ascii;
	}
	if (!meta.year) {
		const fallback = firstYearCandidate(content);
		if (fallback) {
			meta.textYear = fallback.original;
			if (fallback.ascii !== fallback.original) meta.textYearAscii = fallback.ascii;
		}
	}

	// Guess last name from author if missing
	const authorGuess = meta.author ? stripMarkup(meta.author) : '';
	if (!meta.last && authorGuess) {
		const parts = authorGuess.split(/[,;]| and /i);
		meta.last = parts[0]?.trim();
	}

	// Extract phrase from content
	const phraseSource = stripMarkup(content);
	if (phraseSource) {
		meta.phrase = phraseSource.split(/\s+/).slice(0, 6).join(' ');
	}

	// Apply template-specific overrides
	if (templateName === 'cite tweet') {
		const user = pick('user');
		const userClean = user ? stripMarkup(user) : '';
		if (userClean) {
			if (!meta.author) meta.author = userClean;
			if (!meta.last) meta.last = userClean;
		}
		if (!meta.work) meta.work = 'Twitter';
		if (!meta.publisher) meta.publisher = 'Twitter';
		if (!meta.domain) meta.domain = 'twitter.com';
		if (!meta.domainShort) meta.domainShort = 'twitter';
	} else if (templateName === 'cite arxiv') {
		if (!meta.work) meta.work = 'arXiv';
		if (!meta.publisher) meta.publisher = 'arXiv';
		if (!meta.domain) meta.domain = 'arxiv.com';
		if (!meta.domainShort) meta.domainShort = 'arxiv';
	} else if (templateName === 'cite biorxiv') {
		if (!meta.work) meta.work = 'bioRxiv';
		if (!meta.publisher) meta.publisher = 'bioRxiv';
		if (!meta.domain) meta.domain = 'biorxiv.org';
		if (!meta.domainShort) meta.domainShort = 'biorxiv';
	} else if (templateName === 'cite citeseerx') {
		if (!meta.work) meta.work = 'CiteSeerX';
		if (!meta.publisher) meta.publisher = 'CiteSeerX';
		if (!meta.domain) meta.domain = 'citeseerx.ist.psu.edu';
		if (!meta.domainShort) meta.domainShort = 'citeseerx';
	} else if (templateName === 'cite ssrn') {
		if (!meta.work) meta.work = 'SSRN';
		if (!meta.publisher) meta.publisher = 'SSRN';
		if (!meta.domain) meta.domain = 'ssrn.com';
		if (!meta.domainShort) meta.domainShort = 'ssrn';
	} else if (templateName) {
		if (!meta.domainShort) meta.domainShort = templateName.replace('cite ', '').replace(' ', '_');
	}

	return meta;
}

/**
 * Normalize a string to a key for comparison.
 * @param name - Input string.
 * @returns Normalized key.
 */
export function normalizeKey(name: string): string {
	return normalizeNameKey(name);
}

/**
 * Sanitize a token for inclusion in a filename.
 * @param token - Input token.
 * @param config - Mass rename configuration.
 * @returns Sanitized token.
 */
function sanitizeToken(token: string, config: MassRenameConfig): string {
	if (!token) return '';
	let text = stripMarkup(token);
	if (config.stripDiacritics) {
		text = text.normalize('NFD').replace(/\p{Mn}/gu, '');
	}
	if (config.stripPunctuation) {
		text = text.replace(/[\p{P}\p{S}]+/gu, ' ');
	}
	text = text.replace(/[<>{}\[\]|"]/g, ' ');
	text = text.trim();
	if (config.lowercase) {
		text = text.toLowerCase();
	}
	const spaceReplacement = config.replaceSpaceWith;
	text = text.replace(/\s+/g, spaceReplacement);
	text = text.replace(/_{2,}/g, '_').replace(/\s{2,}/g, ' ');
	return text.trim();
}

/**
 * Pick a field value from metadata.
 * @param meta - Reference metadata.
 * @param field - Field to pick.
 * @returns Field value or null.
 */
function pickField(meta: RefMetadata, field: NamingField): string | null {
	switch (field) {
		case 'last':
			return meta.last || null;
		case 'first':
			return meta.first || null;
		case 'author':
			return meta.author || meta.last || null;
		case 'title':
			return meta.title || null;
		case 'work':
			return meta.work || null;
		case 'publisher':
			return meta.publisher || null;
		case 'domain':
			return meta.domain || null;
		case 'domainShort':
			return meta.domainShort || null;
		case 'phrase':
			return meta.phrase || null;
		case 'year':
			return meta.year || meta.textYear || null;
		case 'fulldate':
			return meta.dateYMD || null;
		default:
			return null;
	}
}

/**
 * Pick a year value from metadata, considering configuration.
 * @param meta - Reference metadata.
 * @param config - Mass rename configuration.
 * @returns Year value or null.
 */
function pickYear(meta: RefMetadata, config: MassRenameConfig): string | null {
	const direct = config.convertYearDigits ? meta.yearAscii || meta.year : meta.year;
	if (direct) return direct;
	return null;
}

/**
 * Ensure a name is unique within a reserved set, appending suffixes as needed.
 * @param base - Base name.
 * @param reserved - Set of reserved normalized names.
 * @param config - Mass rename configuration.
 * @returns Unique name.
 */
function ensureUniqueName(base: string, reserved: Set<string>, config: MassRenameConfig): string {
	const cleanBase = base || 'ref';
	let name = cleanBase;
	let normalized = normalizeKey(name);
	if (normalized && !reserved.has(normalized)) {
		reserved.add(normalized);
		return name;
	}
	const delimiter = config.delimiterConditional && !/\d$/.test(cleanBase) ? '' : config.delimiter;
	let counter = config.incrementStyle === 'numeric' ? 2 : 0;
	do {
		const suffix = config.incrementStyle === 'numeric' ? String(counter) : toLatin(counter);
		name = `${cleanBase}${delimiter}${suffix}`;
		normalized = normalizeKey(name);
		counter++;
	} while (normalized && reserved.has(normalized));
	if (normalized) reserved.add(normalized);
	return name;
}

/**
 * Join parts into a single name string.
 * @param parts - Parts to join.
 * @param config - Mass rename configuration.
 * @returns Joined name.
 */
function joinParts(parts: string[], config: MassRenameConfig): string {
	let acc = '';
	for (const part of parts) {
		if (!part) continue;
		if (!acc) {
			acc = part;
			continue;
		}
		const useDelimiter = config.delimiterConditional ? /\d$/.test(acc) : true;
		acc += (useDelimiter ? config.delimiter : '') + part;
	}
	return acc;
}

/**
 * Build a suggested name for a reference.
 * @param meta - Reference metadata.
 * @param ref - Reference object.
 * @param config - Mass rename configuration.
 * @param reserved - Set of reserved normalized names.
 * @returns Suggested name.
 */
export function buildSuggestion(
	meta: RefMetadata,
	ref: Reference,
	config: MassRenameConfig,
	reserved: Set<string>
): string {
	const fields = normalizeFieldSelection(config.fields && config.fields.length ? config.fields : DEFAULT_FIELDS);
	const rawParts: string[] = [];

	fields.forEach((key) => {
		if (key === 'year') {
			const year = pickYear(meta, config);
			if (year) rawParts.push(year);
			return;
		}
		if (key === 'fulldate') {
			if (meta.dateYMD) rawParts.push(meta.dateYMD);
			return;
		}
		const candidate = pickField(meta, key);
		if (candidate) rawParts.push(candidate);
	});

	// Fallback if no parts were extracted
	if (rawParts.length === 0) {
		const fallbackOrder: NamingField[] = ['title', 'domainShort', 'domain', 'phrase', 'author', 'work', 'year', 'fulldate'];
		for (const key of fallbackOrder) {
			if (key === 'year') {
				const year = pickYear(meta, config);
				if (year) {
					rawParts.push(year);
					break;
				}
				continue;
			}
			if (key === 'fulldate') {
				if (meta.dateYMD) {
					rawParts.push(meta.dateYMD);
					break;
				}
				continue;
			}
			const candidate = pickField(meta, key);
			if (candidate) {
				rawParts.push(candidate);
				break;
			}
		}
	}

	const sanitizedParts = rawParts
		.map((p) => sanitizeToken(p, config))
		.map((p) => p.trim())
		.filter((p) => p.length > 0);

	let combined = joinParts(sanitizedParts, config);
	if (!combined) {
		combined = sanitizeToken(ref.name || meta.domain || meta.phrase || ref.id || 'ref', config);
	}
	combined = combined || 'ref';
	combined = ensureUniqueName(combined, reserved, config);
	return combined;
}
