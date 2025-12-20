import {Reference} from '../types';
import {extractAttr} from './string_utils';

/**
 * Parse wikitext for basic ref usages.
 * Extracts named and unnamed references from various wikitext formats including
 * <ref> tags, self-closing refs, and {{r|...}} template syntax.
 *
 * @param wikitext - The raw wikitext string to parse for references.
 * @returns An array of parsed Reference objects with their metadata and usage information.
 */
export function parseReferences(wikitext: string): Reference[] {
	const refs = new Map<string, Reference>();
	let namelessCounter = 0;

	const getOrCreateRef = (name: string | null, group: string | null, content: string): Reference => {
		const key = name ?? `__nameless_${namelessCounter++}`;
		const existing = refs.get(key);

		if (existing) {
			if (content && !existing.contentWikitext) {
				existing.contentWikitext = content;
			}
			return existing;
		}

		const ref: Reference = {
			id: key, name, group, contentWikitext: content, uses: []
		};
		refs.set(key, ref);
		return ref;
	};

	// Sanitize wikitext to remove comments, nowiki, pre, syntaxhighlight blocks
	const sanitized = sanitizeWikitext(wikitext);

	// Parse self-closing refs: <ref name="foo" />
	// Attribute pattern allows quoted values with any chars including /
	const refSelfClosing = /<ref\b((?:\s+\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+))*)\s*\/>/gi;
	let match: RegExpExecArray | null;
	while ((match = refSelfClosing.exec(sanitized)) !== null) {
		const attrs = match[1] ?? '';
		const name = extractAttr(attrs, 'name');
		const group = extractAttr(attrs, 'group');
		const ref = getOrCreateRef(name, group, '');
		ref.uses.push({ index: ref.uses.length, anchor: null });
	}

	// Parse full refs: <ref>content</ref> and <ref name="foo">content</ref>
	// Match opening tag that is NOT self-closing (no / before >)
	const refTagFull = /<ref\b((?:\s+\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s/>]+))*)(?<!\s*\/)\s*>([\s\S]*?)<\/ref>/gi;
	while ((match = refTagFull.exec(sanitized)) !== null) {
		const attrs = match[1] ?? '';
		const content = match[2] ?? '';
		const name = extractAttr(attrs, 'name');
		const group = extractAttr(attrs, 'group');
		const ref = getOrCreateRef(name, group, content.trim());
		ref.uses.push({ index: ref.uses.length, anchor: null });
	}

	// Parse {{r|...}} templates (may contain multiple names)
	const refTemplate = /\{\{\s*r\s*(\|[\s\S]*?)\}\}/gi;
	while ((match = refTemplate.exec(sanitized)) !== null) {
		const params = match[1] ?? '';
		const entries = parseRTemplateEntries(params);
		entries
			.filter((e) => e.isName)
			.forEach((entry) => {
				const ref = getOrCreateRef(entry.value, null, '');
				ref.uses.push({ index: ref.uses.length, anchor: null });
			});
	}

	return Array.from(refs.values());
}

/**
 * Parsed parameter entry from an {{r|...}} template.
 * Keeps order and whether the param is treated as a ref name.
 */
export type RTemplateEntry = {
    key: string | null;
    value: string;
    kind: 'name' | 'group' | 'page' | 'pages' | 'at' | 'other';
    index: number;
    isName: boolean;
};

/**
 * Parse {{r|...}} parameters into ordered entries.
 * Name params are positional, numeric (1=,2=), or name=.
 * All other params (e.g., p=, p2=, lang=) are preserved as-is.
 */
export function parseRTemplateEntries(paramString: string): RTemplateEntry[] {
	const trimmed = paramString.replace(/^\|/, '');
	if (!trimmed) return [];
	const parts = splitTemplateParams(trimmed);
	const entries: RTemplateEntry[] = [];
	let nameCounter = 0;
	let lastNameIndex = 0;
	let hasGroupIndex1 = false;
	parts.forEach((part) => {
		const raw = part.trim();
		if (!raw) return;
		const eqIdx = raw.indexOf('=');
		let key = '';
		let value = raw;
		if (eqIdx >= 0) {
			key = raw.slice(0, eqIdx).trim();
			value = raw.slice(eqIdx + 1).trim();
		}

		const nameIdxMatch = key.match(/^(?:name|n)?(\d*)$/i);
		const groupIdxMatch = key.match(/^(?:grp|group|g)?(\d*)$/i);
		const pageIdxMatch = key.match(/^(?:page|p)?(\d*)$/i);
		const pagesIdxMatch = key.match(/^(?:pages|pp)?(\d*)$/i);
		const atIdxMatch = key.match(/^(?:at|location|loc)?(\d*)$/i);

		let kind: RTemplateEntry['kind'] = 'other';
		let idx = Math.max(nameCounter, 1);

		if (nameIdxMatch && (!key || /^name\d*$/i.test(key) || /^n\d*$/i.test(key) || /^\d+$/.test(key))) {
			kind = 'name';
			if (nameIdxMatch[1]) {
				idx = parseInt(nameIdxMatch[1], 10);
			} else {
				nameCounter += 1;
				idx = nameCounter;
			}
			lastNameIndex = idx;
		} else if (groupIdxMatch && (/^(grp|group|g)\d*$/i.test(key) || key === '')) {
			kind = 'group';
			if (groupIdxMatch[1]) {
				idx = parseInt(groupIdxMatch[1], 10);
			} else if (hasGroupIndex1 && lastNameIndex > 1) {
				idx = lastNameIndex;
			} else {
				idx = 1;
			}
			if (idx === 1) {
				hasGroupIndex1 = true;
			}
		} else if (pageIdxMatch && (/^(page|p)\d*$/i.test(key) || key === '')) {
			kind = 'page';
			idx = pageIdxMatch[1] ? parseInt(pageIdxMatch[1], 10) : 1;
		} else if (pagesIdxMatch && (/^(pages|pp)\d*$/i.test(key) || key === '')) {
			kind = 'pages';
			idx = pagesIdxMatch[1] ? parseInt(pagesIdxMatch[1], 10) : 1;
		} else if (atIdxMatch && (/^(at|location|loc)\d*$/i.test(key) || key === '')) {
			kind = 'at';
			idx = atIdxMatch[1] ? parseInt(atIdxMatch[1], 10) : 1;
		}

		if (kind === 'other') {
			const digitMatch = key.match(/(\d+)$/);
			if (digitMatch) {
				idx = parseInt(digitMatch[1], 10);
			}
		}

		const isNameKey = kind === 'name';
		if (!value) return;
		if (isNameKey && idx > nameCounter) {
			nameCounter = idx;
		}
		entries.push({ key: key || null, value, isName: isNameKey, kind, index: idx || 1 });
	});

	return entries;
}

/**
 * Remove comments and non-ref markup from wikitext to simplify parsing.
 * Strips HTML comments, nowiki, pre, and syntaxhighlight blocks.
 * @param text - Raw wikitext to sanitize.
 * @returns Sanitized wikitext with problematic blocks removed.
 */
function sanitizeWikitext(text: string): string {
	let t = String(text || '');
	t = t.replace(/<!--[\s\S]*?-->/g, '');
	t = t.replace(/<nowiki\b[^>]*>[\s\S]*?<\/nowiki>/gi, '');
	t = t.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '');
	t = t.replace(/<syntaxhighlight\b[^>]*>[\s\S]*?<\/syntaxhighlight>/gi, '');
	t = t.replace(/<nowiki\b[^>]*\/\s*>/gi, '');
	return t;
}

/**
 * Get the alphabetical grouping key for a reference name.
 * Returns '#' for numeric, '*' for unnamed/special, or uppercase letter.
 * @param name - The reference name to categorize.
 * @returns Single character representing the group.
 */
export function groupKey(name: string | null | undefined): string {
	if (!name) return '*';
	const first = name.trim().charAt(0);
	if (!first) return '*';
	if (/[0-9]/.test(first)) return '#';
	if (/[a-z]/i.test(first)) return first.toUpperCase();
	return '*';
}

/**
 * Split template parameters on pipes while keeping nested templates intact.
 * @param text - Parameter string without leading template braces.
 */
export function splitTemplateParams(text: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (ch === '{' && next === '{') {
			depth++;
			current += ch;
			continue;
		}
		if (ch === '}' && next === '}') {
			if (depth > 0) depth--;
			current += ch;
			continue;
		}
		if (ch === '|' && depth === 0) {
			parts.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	if (current) parts.push(current);
	return parts.map((p) => p.trim());
}

/**
 * Check if a ref name appears auto-generated/VE style.
 * @param name - Ref name to test.
 */
export function isAutoGeneratedName(name: string | null): boolean {
	if (!name) return true;
	const trimmed = name.trim();
	return /^:\d+$/.test(trimmed) || /^(?:ref|reference|note|auto(?:generated)?\d*|Reference[A-Z]+)$/i.test(trimmed);
}

export type RefKey = string;
type RefUseKind = 'selfClosing' | 'full' | 'templateR';

export interface RefUseInternal {
	name: string | null;
	group: string | null;
	start: number;
	end: number;
	kind: RefUseKind;
	content?: string;
	rTemplateId?: number;
}

export interface RefRecord {
	id: string;
	name: string | null;
	group: string | null;
	key: RefKey;
	definitions: RefUseInternal[];
	uses: RefUseInternal[];
	ldrDefinitions: RefUseInternal[];
	canonical?: RefRecord;
	targetLocation: 'inline' | 'ldr';
}

export interface TemplateMatch {
	start: number;
	end: number;
	name: string;
	content: string;
	params: TemplateParam[];
}

export interface ReferencesTagMatch {
	start: number;
	end: number;
	content: string;
	attrs: string;
	inner: string;
	innerStart: number;
}

export interface TemplateParam {
	name: string | null;
	value: string;
}

/**
 * Generate a reference key from name and group.
 * @param name - Reference name.
 * @param group - Reference group.
 * @returns Generated reference key.
 */
export function refKey(name: string | null, group: string | null): RefKey {
	return `${group ?? ''}::${name ?? ''}`;
}

/**
 * Iterate over reference records in a map.
 * @param refs - Map of reference records.
 * @returns Array of reference records.
 */
export function refIterator(refs: Map<RefKey, RefRecord>): RefRecord[] {
	return Array.from(refs.values());
}

/**
 * Parse wikitext for refs, uses, and reflist templates.
 * @param wikitext - Source wikitext to parse.
 * @param reflistNames - Names of reflist templates to detect.
 * @returns Parsed references, templates, and reflist template entries.
 */
export function parseWikitext(wikitext: string, reflistNames: string[]): {
	refs: Map<RefKey, RefRecord>;
	templates: TemplateMatch[];
	referencesTags: ReferencesTagMatch[];
	rTemplates: Array<{ id: number; start: number; end: number; entries: RTemplateEntry[] }>
} {
	const refs = new Map<RefKey, RefRecord>();
	const templates = findTemplates(wikitext, reflistNames);
	const referencesTags = findReferencesTags(wikitext);
	const rTemplates: Array<{ id: number; start: number; end: number; entries: RTemplateEntry[] }> = [];
	let namelessCounter = 0;

	// Helper to get or create a RefRecord
	const getRef = (name: string | null, group: string | null): RefRecord => {
		const key = name ? refKey(name, group) : `__nameless_${namelessCounter++}`;
		const existing = refs.get(key);
		if (existing) return existing;
		const rec: RefRecord = {
			id: key, name, group, key, definitions: [], uses: [], ldrDefinitions: [], targetLocation: 'inline'
		};
		refs.set(key, rec);
		return rec;
	};

	// Parse full <ref>...</ref> tags
	const refFull = /<ref\b([^>/]*?)>([\s\S]*?)<\/ref>/gi;
	for (const match of wikitext.matchAll(refFull)) {
		const idx = match.index ?? 0;
		if (inTemplateRange(idx, templates, referencesTags)) continue;
		const attrs = match[1] ?? '';
		const content = match[2] ?? '';
		const name = extractAttr(attrs, 'name');
		const group = extractAttr(attrs, 'group');
		const ref = getRef(name, group);
		const use: RefUseInternal = {
			name, group, start: idx, end: idx + match[0].length, kind: 'full', content
		};
		ref.definitions.push(use);
		ref.uses.push(use);
	}

	// Parse self-closing <ref ... /> tags
	const refSelf = /<ref\b([^>]*?)\/\s*>/gi;
	for (const match of wikitext.matchAll(refSelf)) {
		const idx = match.index ?? 0;
		if (inTemplateRange(idx, templates, referencesTags)) continue;
		const attrs = match[1] ?? '';
		const name = extractAttr(attrs, 'name');
		const group = extractAttr(attrs, 'group');
		const ref = getRef(name, group);
		const use: RefUseInternal = {
			name, group, start: idx, end: idx + match[0].length, kind: 'selfClosing'
		};
		ref.uses.push(use);
	}

	// Parse {{r|...}} templates
	const rTemplate = /\{\{\s*r\s*(\|[\s\S]*?)\}\}/gi;
	for (const match of wikitext.matchAll(rTemplate)) {
		const idx = match.index ?? 0;
		if (inTemplateRange(idx, templates, referencesTags)) continue;
		const params = match[1] ?? '';
		const entries = parseRTemplateEntries(params);
		const tplId = rTemplates.length;
		rTemplates.push({ id: tplId, start: idx, end: idx + match[0].length, entries });
		entries
			.filter((e) => e.isName)
			.forEach((entry) => {
				const ref = getRef(entry.value, null);
				const use: RefUseInternal = {
					name: entry.value, group: null, start: idx, end: idx + match[0].length, kind: 'templateR', rTemplateId: tplId
				};
				ref.uses.push(use);
			});
	}

	// Parse list-defined refs inside reflist templates
	templates.forEach((tpl) => {
		const refsParam = tpl.params.find((p) => p.name && p.name.toLowerCase() === 'refs');
		if (refsParam && refsParam.value) {
			const inner = refsParam.value;
			let innerMatch: RegExpExecArray | null;
			const innerFull = /<ref\b([^>/]*?)>([\s\S]*?)<\/ref>/gi;
			const paramOffset = tpl.content.indexOf(inner);
			const basePos = paramOffset >= 0 ? tpl.start + paramOffset : tpl.start;
			while ((innerMatch = innerFull.exec(inner)) !== null) {
				const attrs = innerMatch[1] ?? '';
				const content = innerMatch[2] ?? '';
				const name = extractAttr(attrs, 'name');
				const group = extractAttr(attrs, 'group');
				const ref = getRef(name, group);
				const posStart = basePos + (innerMatch.index ?? 0);
				const use: RefUseInternal = {
					name, group, start: posStart, end: posStart + innerMatch[0].length, kind: 'full', content
				};
				ref.ldrDefinitions.push(use);
			}
		}
	});

	// Parse list-defined refs inside <references> tags
	referencesTags.forEach((tag) => {
		if (!tag.inner) return;
		let innerMatch: RegExpExecArray | null;
		const innerFull = /<ref\b([^>/]*?)>([\s\S]*?)<\/ref>/gi;
		while ((innerMatch = innerFull.exec(tag.inner)) !== null) {
			const attrs = innerMatch[1] ?? '';
			const content = innerMatch[2] ?? '';
			const name = extractAttr(attrs, 'name');
			const group = extractAttr(attrs, 'group');
			const ref = getRef(name, group);
			const posStart = tag.innerStart + (innerMatch.index ?? 0);
			const use: RefUseInternal = {
				name, group, start: posStart, end: posStart + innerMatch[0].length, kind: 'full', content
			};
			ref.ldrDefinitions.push(use);
		}
	});

	return { refs, templates, referencesTags, rTemplates };
}

/**
 * Check if an index is within any of the given template ranges.
 * @param idx - Index to check.
 * @param templates - Array of template matches with start and end positions.
 * @param referencesTags - Array of references tag matches with start and end positions.
 * @returns True if index is within any template range, false otherwise.
 */
function inTemplateRange(idx: number, templates: TemplateMatch[], referencesTags: ReferencesTagMatch[] = []): boolean {
	if (templates.some((tpl) => idx >= tpl.start && idx <= tpl.end)) return true;
	return referencesTags.some((tag) => idx >= tag.start && idx <= tag.end);
}

/**
 * Find template instances with simple brace depth parsing.
 * @param source - Source wikitext to search.
 * @param names - Template names to look for (case-insensitive).
 * @returns Array of found template matches.
 */
function findTemplates(source: string, names: string[]): TemplateMatch[] {
	const matches: TemplateMatch[] = [];
	const lowerNames = names.map((n) => n.toLowerCase());
	let i = 0;
	while (i < source.length) {
		const idx = source.indexOf('{{', i);
		if (idx === -1) break;

		let j = idx + 2;
		while (j < source.length && /\s/.test(source[j])) j++;
		let nameEnd = j;
		while (nameEnd < source.length && /[A-Za-z0-9_:-]/.test(source[nameEnd])) nameEnd++;
		const name = source.slice(j, nameEnd);
		if (!lowerNames.includes(name.toLowerCase())) {
			i = idx + 2;
			continue;
		}

		let depth = 1;
		let k = nameEnd;
		while (k < source.length && depth > 0) {
			if (source[k] === '{' && source[k + 1] === '{') {
				depth++;
				k += 2;
				continue;
			}
			if (source[k] === '}' && source[k + 1] === '}') {
				depth--;
				k += 2;
				continue;
			}
			k++;
		}
		if (depth !== 0) {
			i = nameEnd;
			continue;
		}

		const end = k;
		const content = source.slice(idx, end);
		const paramText = source.slice(nameEnd, end - 2); // strip closing braces
		const params = parseTemplateParams(paramText);
		matches.push({ start: idx, end, name, content, params });
		i = end;
	}
	return matches;
}

/**
 * Find <references> tags in source wikitext.
 * @param source - Source wikitext to search.
 * @returns Array of found references tag matches.
 */
function findReferencesTags(source: string): ReferencesTagMatch[] {
	const matches: ReferencesTagMatch[] = [];
	const blockRe = /<references\b([^>]*)>([\s\S]*?)<\/references\s*>/gi;
	let m: RegExpExecArray | null;
	while ((m = blockRe.exec(source)) !== null) {
		const start = m.index ?? 0;
		const content = m[0];
		const attrs = (m[1] ?? '').trim();
		const inner = m[2] ?? '';
		const openTagMatch = content.match(/^<references\b[^>]*>/i);
		const innerOffset = openTagMatch ? openTagMatch[0].length : 0;
		const innerStart = start + innerOffset;
		matches.push({
			start,
			end: start + content.length,
			content,
			attrs,
			inner,
			innerStart
		});
	}

	const selfClosingRe = /<references\b([^>]*)\/\s*>/gi;
	while ((m = selfClosingRe.exec(source)) !== null) {
		const start = m.index ?? 0;
		const content = m[0];
		const attrs = (m[1] ?? '').trim();
		const innerStart = start + content.length;
		matches.push({
			start,
			end: start + content.length,
			content,
			attrs,
			inner: '',
			innerStart
		});
	}

	return matches;
}

/**
 * Parse template parameters from a parameter string.
 * @param paramText - Raw parameter string (including leading '|').
 * @returns Parsed template parameters.
 */
export function parseTemplateParams(paramText: string): TemplateParam[] {
	// Allow either a raw parameter string (starting with "|") or a full template like "{{cite web|url=...}}".
	let working = paramText.trim();
	if (working.startsWith('{{')) {
		// Strip outer braces if present, then drop the template name up to the first pipe.
		if (working.endsWith('}}') && working.length >= 4) {
			working = working.slice(2, -2).trim();
		} else {
			working = working.replace(/^\{\{/, '').trim();
		}
		const pipeIdx = working.indexOf('|');
		working = pipeIdx === -1 ? '' : working.slice(pipeIdx + 1);
	}

	const trimmed = working.replace(/^\s*\|?/, '');
	if (!trimmed) return [];
	const parts = splitParams(trimmed);
	let numberedIndex = 0;
	return parts.map((p) => {
		const eqIdx = p.indexOf('=');
		if (eqIdx === -1) return { name: (++numberedIndex).toString(), value: p };
		const name = p.slice(0, eqIdx).trim();
		const value = p.slice(eqIdx + 1);
		return { name, value };
	});
}

/**
 * Pick the first matching parameter value from a template param list or a record.
 * @param params - Template parameters.
 * @param keys - Parameter names to look for (case-insensitive).
 * @returns The first matching parameter value, or undefined if none found.
 */
export function pickTemplateParams(params: TemplateParam[], ...keys: string[]): string | undefined {
	if (!params || keys.length === 0) return undefined;
	const keySet = new Set(keys.filter(Boolean).map((k) => k.toLowerCase()));
	if (keySet.size === 0) return undefined;
	for (const p of params) {
		const name = p.name?.toLowerCase();
		if (!name || !keySet.has(name)) continue;
		const value = p.value?.trim();
		if (value) return p.value;
	}
	return undefined;
}

/**
 * Split template parameter string into individual parameters, respecting nested braces and links.
 * @param text - Raw parameter string.
 * @returns Array of individual parameter strings.
 */
function splitParams(text: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	let linkDepth = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (ch === '{' && next === '{') {
			depth++;
			current += ch;
			continue;
		}
		if (ch === '}' && next === '}') {
			if (depth > 0) depth--;
			current += ch;
			continue;
		}
		if (ch === '[' && next === '[') {
			linkDepth++;
			current += ch;
			continue;
		}
		if (ch === ']' && next === ']') {
			if (linkDepth > 0) linkDepth--;
			current += ch;
			continue;
		}
		if (ch === '|' && depth === 0 && linkDepth === 0) {
			parts.push(current);
			current = '';
			continue;
		}
		current += ch;
	}
	if (current) parts.push(current);
	return parts.map((p) => p.trim());
}
