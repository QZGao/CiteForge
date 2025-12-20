import { Reference } from '../types';
import { escapeAttr } from './string_utils';
import { getTemplateAliasMap, getTemplateParamOrder } from '../data/templatedata_fetch';

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

export function parseRTemplateNames(paramString: string): string[] {
	return parseRTemplateEntries(paramString)
		.filter((e) => e.isName)
		.map((e) => e.value);
}

/**
 * Attaches DOM elements to references based on their names.
 *
 * This function iterates through a list of references and associates
 * them with corresponding anchor elements found in the document.
 * It updates the `anchor` property of each reference's `uses` array
 * with the appropriate anchor element, or adds a new entry if all
 * existing uses have been assigned.
 *
 * @param refs - An array of Reference objects that contain the name
 *               and uses to be attached to the corresponding DOM elements.
 */
export function attachDomUses(refs: Reference[]): void {
	const byName = new Map<string, Reference>();
	const attachCursor = new Map<string, number>();

	refs.forEach((ref) => {
		if (ref.name) {
			byName.set(ref.name, ref);
			attachCursor.set(ref.name, 0);
		}
	});

	if (!byName.size) {
		return;
	}

	const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('sup.reference a[href], span.reference a[href]'));

	anchors.forEach((anchor) => {
		const href = anchor.getAttribute('href') || '';
		byName.forEach((ref, name) => {
			const encodedName = encodeURIComponent(name);
			if (href.includes(`cite_note-${name}`) || href.includes(`cite_note-${encodedName}`) || href.includes(`cite_ref-${name}`) || href.includes(`cite_ref-${encodedName}`)) {
				const cursor = attachCursor.get(name) ?? 0;
				if (cursor < ref.uses.length) {
					ref.uses[cursor].anchor = anchor;
					attachCursor.set(name, cursor + 1);
				} else {
					ref.uses.push({ index: ref.uses.length, anchor });
				}
			}
		});
	});
}

/**
 * Extract an attribute value from an HTML/XML attribute string.
 * Supports quoted (single/double) and unquoted attribute values.
 * @param attrs - The attribute string to search (e.g., 'name="foo" group="bar"').
 * @param attrName - The name of the attribute to extract.
 * @returns The attribute value, or null if not found.
 */
export function extractAttr(attrs: string, attrName: string): string | null {
	const regex = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
	const match = attrs.match(regex);
	if (!match) return null;
	return match[1] ?? match[2] ?? match[3] ?? null;
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
 * Format a reference name for copying based on user preference.
 * @param name - The reference name to format.
 * @param fmt - The format style: 'raw', 'r' (template), or 'ref' (tag).
 * @returns Formatted string ready for clipboard.
 */
export function formatCopy(name: string, fmt: 'raw' | 'r' | 'ref'): string {
	if (fmt === 'r') return `{{r|${name}}}`;
	if (fmt === 'ref') return `<ref name="${escapeAttr(name)}" />`;
	return name;
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
export function isAutoName(name: string | null): boolean {
	if (!name) return true;
	const trimmed = name.trim();
	return /^:\d+$/.test(trimmed) || /^(?:ref|reference|note|auto(?:generated)?\d*|Reference[A-Z]+)$/i.test(trimmed);
}

type LocationMode = 'keep' | 'all_inline' | 'all_ldr' | { minUsesForLdr: number };

export interface TransformOptions {
	renameMap?: Record<string, string | null>;
	renameNameless?: Record<string, string | null>;
	dedupe?: boolean;
	locationMode?: LocationMode;
	sortRefs?: boolean;
	useTemplateR?: boolean;
	reflistTemplates?: string[];
	normalizeAll?: boolean;
	contentOverrides?: Record<string, string>;
}

export interface TransformResult {
	wikitext: string;
	changes: {
		renamed: Array<{ from: string; to: string | null }>;
		deduped: Array<{ from: string; to: string }>;
		movedToLdr: string[];
		movedToInline: string[];
	};
	warnings: string[];
}

type RefKey = string;
type RefUseKind = 'selfClosing' | 'full' | 'templateR';

interface RefUseInternal {
	name: string | null;
	group: string | null;
	start: number;
	end: number;
	kind: RefUseKind;
	content?: string;
	rTemplateId?: number;
}

interface RefRecord {
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

interface TemplateMatch {
	start: number;
	end: number;
	name: string;
	content: string;
	params: TemplateParam[];
}

interface ReferencesTagMatch {
	start: number;
	end: number;
	content: string;
	attrs: string;
	inner: string;
	innerStart: number;
}

interface TemplateParam {
	name: string | null;
	value: string;
}

const DEFAULT_REFLIST_TEMPLATES = ['reflist', 'references'];

/**
 * Transform wikitext by applying rename, dedupe, and location rules without saving.
 * Produces updated wikitext and a change summary.
 * @param wikitext - Source wikitext to transform.
 * @param options - Transformation options.
 * @returns Transformation result with updated wikitext and change details.
 */
export function transformWikitext(wikitext: string, options: TransformOptions = {}): TransformResult {
	const warnings: string[] = [];
	const renameMap = normalizeRenameMap(options.renameMap || {});
	const renameNameless = options.renameNameless || {};
	const dedupe = Boolean(options.dedupe);
	const sortRefs = options.sortRefs === undefined ? false : Boolean(options.sortRefs);
	const useTemplateR = Boolean(options.useTemplateR);
	const normalizeAll = options.normalizeAll === undefined ? false : options.normalizeAll !== false;
	const reflistNames = (options.reflistTemplates && options.reflistTemplates.length > 0 ? options.reflistTemplates : DEFAULT_REFLIST_TEMPLATES).map((n) => n.toLowerCase());
	const targetMode = normalizeLocationMode(options.locationMode);
	const contentOverrides = options.contentOverrides || {};
	const contentOverrideLookup = (ref: RefRecord): string | undefined => {
		const candidates = [ref.id, ref.key];
		for (const key of candidates) {
			if (!key) continue;
			if (Object.prototype.hasOwnProperty.call(contentOverrides, key)) {
				return contentOverrides[key];
			}
		}
		return undefined;
	};

	const ctx = parseWikitext(wikitext, reflistNames);
	ctx.refs = normalizeRefKeys(ctx.refs);

	applyRenames(ctx.refs, renameMap, renameNameless);
	ctx.refs = normalizeRefKeys(ctx.refs);
	const deduped = dedupe ? applyDedupe(ctx.refs) : [];
	assignLocations(ctx.refs, targetMode);

	const plan = buildReplacementPlan(ctx, {
		useTemplateR,
		sortRefs,
		normalizeAll,
		locationModeKeep: targetMode === 'keep',
		renameLookup: (name: string) => renameMap[name],
		contentOverrideLookup
	});

	const replaced = applyReplacements(wikitext, plan.replacements);
	const finalText = useTemplateR ? collapseRefsAndRp(replaced, true) : replaced;

	return {
		wikitext: finalText, changes: {
			renamed: Object.entries(renameMap).map(([from, to]) => ({ from, to })),
			deduped,
			movedToInline: plan.movedInline,
			movedToLdr: plan.movedLdr
		}, warnings
	};
}

/**
 * Build a map of ref identifiers to their first captured content from wikitext,
 * including list-defined references inside reflist templates.
 * @param wikitext - Source wikitext.
 * @param reflistTemplates - Optional override of reflist template names.
 * @returns Map of ref names/IDs to their content strings.
 */
export function getRefContentMap(wikitext: string, reflistTemplates?: string[]): Map<string, string> {
	const reflistNames = (reflistTemplates && reflistTemplates.length > 0 ? reflistTemplates : DEFAULT_REFLIST_TEMPLATES).map((n) => n.toLowerCase());
	const ctx = parseWikitext(wikitext, reflistNames);
	const refs = normalizeRefKeys(ctx.refs);
	const map = new Map<string, string>();
	refIterator(refs).forEach((ref) => {
		const content = firstContent(ref);
		if (!content) return;
		if (ref.name) map.set(ref.name, content);
		map.set(ref.id || ref.key, content);
	});
	return map;
}

/**
 * Normalize location mode input into a consistent format.
 * @param mode - Input location mode.
 * @returns Normalized location mode.
 */
function normalizeLocationMode(mode?: LocationMode): LocationMode {
	if (mode === 'keep') return 'keep';
	if (!mode) return 'keep';
	if (typeof mode === 'string') return mode;
	if (typeof mode.minUsesForLdr === 'number' && mode.minUsesForLdr >= 1) return mode;
	return { minUsesForLdr: 2 };
}

/**
 * Normalize rename map input.
 * @param rename - Raw rename map.
 * @returns Normalized rename map.
 */
function normalizeRenameMap(rename: Record<string, string | null>): Record<string, string | null> {
	const map: Record<string, string | null> = {};
	Object.entries(rename).forEach(([k, v]) => {
		if (!k) return;
		if (v === undefined) return;
		if (v === k) return;
		map[k] = v;
	});
	return map;
}

/**
 * Apply renames to references based on provided maps.
 * Handles both named and nameless references.
 * @param refs - Map of reference records to modify.
 * @param rename - Map of current names to new names (or null to remove).
 * @param renameNameless - Map of nameless ref IDs/keys to new names (or null to remove).
 */
function applyRenames(refs: Map<RefKey, RefRecord>, rename: Record<string, string | null>, renameNameless: Record<string, string | null>): void {
	const appliedNameless = new Set<string>();
	refs.forEach((ref) => {
		if (ref.name) {
			const next = rename[ref.name];
			if (next === null) {
				ref.name = null;
			} else if (next && next !== ref.name) {
				ref.name = next;
			}
		} else {
			const next = renameNameless[ref.id] || renameNameless[ref.key];
			if (next === null) {
				ref.name = null;
				ref.key = ref.key || ref.id || refKey(ref.name, ref.group);
				appliedNameless.add(ref.id);
				appliedNameless.add(ref.key);
			} else if (next) {
				ref.name = next;
				ref.key = refKey(ref.name, ref.group);
				appliedNameless.add(ref.id);
				appliedNameless.add(ref.key);
			}
		}
	});

	// Fallback: apply remaining nameless renames to unnamed refs in order
	const remainingEntries = Object.entries(renameNameless).filter(([k]) => !appliedNameless.has(k));
	if (remainingEntries.length) {
		let idx = 0;
		refIterator(refs).forEach((ref) => {
			if (idx >= remainingEntries.length) return;
			if (ref.name) return;
			const [, newName] = remainingEntries[idx];
			ref.name = newName;
			ref.key = refKey(ref.name, ref.group);
			idx++;
		});
	}
}

/**
 * Deduplicate references based on their content.
 * References with identical content are merged, with one canonical reference retained.
 * @param refs - Map of reference records to deduplicate.
 * @returns Array of changes made during deduplication.
 */
function applyDedupe(refs: Map<RefKey, RefRecord>): Array<{ from: string; to: string }> {
	const canonicalByContent = new Map<string, RefRecord>();
	const changes: Array<{ from: string; to: string }> = [];

	refIterator(refs).forEach((ref) => {
		const content = firstContent(ref);
		if (!content || !ref.name) return;
		const norm = normalizeContent(content);
		const existing = canonicalByContent.get(norm);
		if (existing && existing.name) {
			ref.canonical = existing;
			// Preserve content if canonical lacked it
			if (existing.definitions.length === 0 && ref.definitions.length > 0) {
				existing.definitions.push(...ref.definitions);
			}
			if (existing.ldrDefinitions.length === 0 && ref.ldrDefinitions.length > 0) {
				existing.ldrDefinitions.push(...ref.ldrDefinitions);
			}
			changes.push({ from: ref.name, to: existing.name });
		} else {
			canonicalByContent.set(norm, ref);
			ref.canonical = ref;
		}
	});

	return changes;
}

/**
 * Assign target locations (inline or ldr) to references based on mode and usage.
 * @param refs - Map of reference records to assign locations.
 * @param mode - Location mode determining assignment rules.
 */
function assignLocations(refs: Map<RefKey, RefRecord>, mode: LocationMode): void {
	const processed = new Set<RefRecord>();
	refIterator(refs).forEach((ref) => {
		const canonical = ref.canonical ?? ref;
		if (processed.has(canonical)) return;
		if (mode === 'keep') {
			if (canonical.ldrDefinitions.length > 0) {
				canonical.targetLocation = 'ldr';
			} else {
				canonical.targetLocation = 'inline';
			}
			processed.add(canonical);
			return;
		}
		if (!canonical.name) {
			canonical.targetLocation = 'inline';
			processed.add(canonical);
			return;
		}

		if (mode === 'all_inline') {
			canonical.targetLocation = 'inline';
			processed.add(canonical);
			return;
		}
		if (mode === 'all_ldr') {
			canonical.targetLocation = 'ldr';
			processed.add(canonical);
			return;
		}
		const usesCount = aggregateUses(refs, canonical).length;
		const threshold = mode.minUsesForLdr;
		canonical.targetLocation = usesCount >= threshold ? 'ldr' : 'inline';
		processed.add(canonical);
	});
}

/**
 * Aggregate all uses of a canonical reference from the given references map.
 * @param refs - Map of reference records.
 * @param canonical - The canonical reference record to aggregate uses for.
 * @returns Sorted array of reference uses.
 */
function aggregateUses(refs: Map<RefKey, RefRecord>, canonical: RefRecord): RefUseInternal[] {
	const collected: RefUseInternal[] = [];
	refIterator(refs).forEach((ref) => {
		if ((ref.canonical ?? ref) === canonical) {
			collected.push(...ref.uses);
		}
	});
	collected.sort((a, b) => a.start - b.start);
	return collected;
}

/**
 * Get the first non-empty content from a reference's definitions or ldrDefinitions.
 * @param ref - Reference record to extract content from.
 * @returns The first non-empty content string or null if none found.
 */
function firstContent(ref: RefRecord): string | null {
	const def = ref.definitions.find((d) => (d.content || '').trim().length > 0) || ref.ldrDefinitions.find((d) => (d.content || '').trim().length > 0);
	return def?.content ?? null;
}

/**
 * Normalize content by collapsing whitespace and trimming.
 * @param content - Content string to normalize.
 * @returns Normalized content string.
 */
function normalizeContent(content: string): string {
	return content.replace(/\s+/g, ' ').trim();
}

/**
 * Generate a reference key from name and group.
 * @param name - Reference name.
 * @param group - Reference group.
 * @returns Generated reference key.
 */
function refKey(name: string | null, group: string | null): RefKey {
	return `${group ?? ''}::${name ?? ''}`;
}

/**
 * Iterate over reference records in a map.
 * @param refs - Map of reference records.
 * @returns Array of reference records.
 */
function refIterator(refs: Map<RefKey, RefRecord>): RefRecord[] {
	return Array.from(refs.values());
}

/**
 * Normalize reference keys in the map.
 * Merges references with the same name and group into a single record.
 * @param refs - Map of reference records to normalize.
 * @returns New map of normalized reference records.
 */
function normalizeRefKeys(refs: Map<RefKey, RefRecord>): Map<RefKey, RefRecord> {
	const next = new Map<RefKey, RefRecord>();
	let namelessCounter = 0;
	refIterator(refs).forEach((ref) => {
		const key = ref.name ? refKey(ref.name, ref.group) : ref.key || ref.id || `__nameless_${namelessCounter++}`;
		ref.key = key;
		ref.id = ref.id || key;
		const existing = next.get(key);
		if (existing) {
			existing.definitions.push(...ref.definitions);
			existing.ldrDefinitions.push(...ref.ldrDefinitions);
			existing.uses.push(...ref.uses);
			ref.canonical = existing;
		} else {
			next.set(key, ref);
		}
	});
	return next;
}

/**
 * Parse wikitext for refs, uses, and reflist templates.
 * @param wikitext - Source wikitext to parse.
 * @param reflistNames - Names of reflist templates to detect.
 * @returns Parsed references, templates, and reflist template entries.
 */
function parseWikitext(wikitext: string, reflistNames: string[]): {
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
 * @returns True if index is within any template range, false otherwise.
 */
function inTemplateRange(idx: number, templates: TemplateMatch[], referencesTags: ReferencesTagMatch[] = []): boolean {
	if (templates.some((tpl) => idx >= tpl.start && idx <= tpl.end)) return true;
	return referencesTags.some((tag) => idx >= tag.start && idx <= tag.end);
}

/**
 * Plan replacements for refs and reflist templates.
 * @param ctx - Parsing context with refs and templates.
 * @param opts - Options for replacement behavior.
 * @returns Replacement plan with text changes and moved refs.
 */
function buildReplacementPlan(ctx: {
	refs: Map<RefKey, RefRecord>;
	templates: TemplateMatch[];
	referencesTags: ReferencesTagMatch[];
	rTemplates: Array<{ id: number; start: number; end: number; entries: RTemplateEntry[] }>
}, opts: {
	useTemplateR: boolean;
	sortRefs: boolean;
	normalizeAll: boolean;
	locationModeKeep: boolean;
	renameLookup?: (name: string) => string | null | undefined;
	contentOverrideLookup?: (ref: RefRecord) => string | undefined;
}): { replacements: Replacement[]; movedInline: string[]; movedLdr: string[] } {
	const replacements: Replacement[] = [];
	const movedInline: string[] = [];
	const movedLdr: string[] = [];

	const canonicalMap = new Map<RefRecord, RefRecord>();
	refIterator(ctx.refs).forEach((ref) => {
		const canonical = ref.canonical ?? ref;
		canonicalMap.set(ref, canonical);
	});

	// Replace chained {{r}} templates preserving names
	ctx.rTemplates.forEach((tpl) => {
		const rendered = renderRTemplate(tpl, ctx.refs, opts.useTemplateR, opts.renameLookup);
		if (rendered !== null) {
			replacements.push({ start: tpl.start, end: tpl.end, text: rendered });
		}
	});

	// Build replacements for individual refs
	refIterator(ctx.refs).forEach((ref) => {
		const canonical = canonicalMap.get(ref) ?? ref;
		const targetName = canonical.name ?? ref.name;
		const targetLocation = canonical.targetLocation;
		const overrideContent = opts.contentOverrideLookup?.(canonical);
		const content = overrideContent !== undefined ? overrideContent : firstContent(canonical);

		// Uses (including ones tied to definitions)
		ref.uses.forEach((use, useIdx) => {
			if (use.kind === 'templateR' && typeof use.rTemplateId === 'number') {
				// Already handled via rTemplates replacement
				return;
			}
			const isDefinition = ref.definitions.includes(use);
			const canonicalContent = content || '';
			if (
				opts.locationModeKeep &&
				!opts.useTemplateR &&
				!opts.normalizeAll &&
				targetName === use.name &&
				ref.group === use.group &&
				((use.kind === 'full' && canonicalContent === use.content) || use.kind !== 'full')
			) {
				return;
			}
			if (targetLocation === 'inline' && canonical === ref && useIdx === 0 && canonicalContent) {
				// Ensure first use holds definition
				const rendered = renderRefTag(targetName, ref.group, canonicalContent, opts.normalizeAll);
				replacements.push({ start: use.start, end: use.end, text: rendered });
				if (targetName) movedInline.push(targetName);
			} else {
				const rendered = renderRefSelf(targetName, ref.group, opts.useTemplateR);
				replacements.push({ start: use.start, end: use.end, text: rendered });
			}
			if (isDefinition && targetLocation === 'ldr' && targetName) {
				movedLdr.push(targetName);
			}
		});

		if (opts.locationModeKeep && ref.ldrDefinitions.length > 0) {
			ref.ldrDefinitions.forEach((def) => {
				const override = opts.contentOverrideLookup?.(canonical);
				const content = override !== undefined ? override : def.content ?? '';
				const targetGroup = def.group ?? ref.group;
				if (!opts.useTemplateR && !opts.normalizeAll && targetName === def.name && targetGroup === def.group) {
					if (override === undefined) {
						return;
					}
				}
				const rendered = content
					? renderRefTag(targetName, targetGroup, content, opts.normalizeAll)
					: renderRefSelf(targetName, targetGroup, opts.useTemplateR);
				replacements.push({ start: def.start, end: def.end, text: rendered });
				if (targetName) movedLdr.push(targetName);
			});
		}
	});

	// Rebuild reflist templates
	if (!opts.locationModeKeep) {
		const ldrEntries = buildLdrEntries(ctx.refs, opts.contentOverrideLookup);
		const hasContainer = ctx.templates.length > 0 || ctx.referencesTags.length > 0;
		ctx.templates.forEach((tpl) => {
			const updated = updateReflistTemplate(tpl, ldrEntries, opts.sortRefs);
			if (updated !== tpl.content) {
				replacements.push({ start: tpl.start, end: tpl.end, text: updated });
			}
		});
		ctx.referencesTags.forEach((tag) => {
			const updated = updateReferencesTag(tag, ldrEntries, opts.sortRefs);
			if (updated !== tag.content) {
				replacements.push({ start: tag.start, end: tag.end, text: updated });
			}
		});

		// If no reflist but we have LDR entries, append one
		if (ldrEntries.length > 0 && !hasContainer) {
			const appendText = buildStandaloneReflist(ldrEntries, opts.sortRefs);
			replacements.push({ start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER, text: appendText });
		}
	}

	// De-duplicate overlapping replacements by keeping last
	const collapsed = collapseReplacements(replacements);

	return { replacements: collapsed, movedInline, movedLdr };
}

/**
 * Build list of LDR entries from references.
 * @param refs - Map of reference records.
 * @returns Array of LDR entries with name, group, and content.
 */
function buildLdrEntries(
	refs: Map<RefKey, RefRecord>,
	contentOverrideLookup?: (ref: RefRecord) => string | undefined
): Array<{ name: string; group: string | null; content: string }> {
	const list: Array<{ name: string; group: string | null; content: string }> = [];
	refIterator(refs).forEach((ref) => {
		const canonical = ref.canonical ?? ref;
		if (canonical !== ref) return;
		if (canonical.targetLocation !== 'ldr') return;
		if (!canonical.name) return;
		const override = contentOverrideLookup?.(canonical);
		const content = override !== undefined ? override : firstContent(canonical);
		if (!content) return;
		list.push({ name: canonical.name, group: canonical.group, content });
	});
	return list;
}

/**
 * Render a self-closing reference tag or template.
 * @param name - Reference name.
 * @param group - Reference group.
 * @param preferTemplateR - Whether to prefer the {{r|...}} template format.
 * @returns Rendered reference string.
 */
function renderRefSelf(name: string | null, group: string | null, preferTemplateR: boolean): string {
	const safeEscape = (value: string): string => escapeAttr(value);
	if (!name) {
		// Fall back to empty self-closing tag
		return '<ref />';
	}
	if (preferTemplateR) {
		const parts = [`${name}`];
		if (group) parts.push(`group=${safeEscape(group)}`);
		return `{{r|${parts.join('|')}}}`;
	}
	const attrs = [`name="${safeEscape(name)}"`];
	if (group) attrs.push(`group="${safeEscape(group)}"`);
	return `<ref ${attrs.join(' ')} />`;
}

/**
 * Render a full reference tag with content.
 * @param name - Reference name.
 * @param group - Reference group.
 * @param content - Reference content.
 * @param normalize - Whether to normalize the content body.
 * @returns Rendered full reference tag string.
 */
function renderRefTag(name: string | null, group: string | null, content: string, normalize = false): string {
	const safeEscape = (value: string): string => escapeAttr(value);
	const attrs: string[] = [];
	if (name) attrs.push(`name="${safeEscape(name)}"`);
	if (group) attrs.push(`group="${safeEscape(group)}"`);
	const inner = normalize ? normalizeRefBody(content) : normalizeContentBlock(content);
	return `<ref${attrs.length ? ' ' + attrs.join(' ') : ''}>${inner}</ref>`;
}

/**
 * Normalize the body of a reference, reordering citation template parameters.
 * @param content - Raw content of the reference.
 * @returns Normalized reference body content.
 */
function normalizeRefBody(content: string): string {
	let text = normalizeContentBlock(content);
	const citeRegex = /\{\{\s*([Cc]ite\s+[^\|\}]+)\s*\|([\s\S]*?)\}\}/g;
	text = text.replace(citeRegex, (match, name: string, paramText: string) => {
		const params = parseTemplateParams('|' + paramText);
		if (!params.length) return match;

		const ordered: TemplateParam[] = [];
		const used = new Set<number>();
		const templateOrder = getTemplateParamOrder(name);
		const aliasMap = getTemplateAliasMap(name);

		const canonicalParam = (paramName?: string | null): string | null => {
			if (!paramName) return null;
			const norm = paramName.trim().toLowerCase();
			return aliasMap[norm] ?? norm;
		};

		templateOrder.forEach((key) => {
			const target = canonicalParam(key);
			if (!target) return;
			const idx = params.findIndex((p, paramIdx) => {
				if (used.has(paramIdx)) return false;
				return canonicalParam(p.name) === target;
			});
			if (idx >= 0 && !used.has(idx)) {
				ordered.push(params[idx]);
				used.add(idx);
			}
		});

		params.forEach((p, idx) => {
			if (!used.has(idx)) {
				ordered.push(p);
				used.add(idx);
			}
		});

		const parts = ordered.map((p) => {
			const val = String(p.value).trim();
			const name = p.name?.trim();
			if (name) return `${name}=${val}`;
			return val;
		});
		return `{{${name.trim()}${parts.length ? ' |' + parts.join(' |') : ''}}}`;
	});

	return text;
}

/**
 * Collapse chains of <ref/> and {{rp|...}} into single {{r|...}} templates.
 * @param text - Source wikitext to process.
 * @param preferTemplateR - Whether to prefer the {{r|...}} template format.
 * @returns Wikitext with collapsed reference chains.
 */
function collapseRefsAndRp(text: string, preferTemplateR: boolean): string {
	if (!preferTemplateR) return text;
	const chainRegex = /(?:(?:<ref\b[^>]*\/>\s*(?:\{\{rp\|[^}]+\}\}\s*)?)|\{\{r\|[^}]+\}\}\s*(?:\{\{rp\|[^}]+\}\}\s*)?)+/gi;

	/**
	 * Tokenize a block of text into ref, r, and rp tokens.
	 * @param block - Text block to tokenize.
	 * @returns Array of tokens with type and raw text.
	 */
	const tokenize = (block: string): Array<{ type: 'ref' | 'r' | 'rp'; raw: string }> => {
		const tokens: Array<{ type: 'ref' | 'r' | 'rp'; raw: string }> = [];
		const re = /<ref\b[^>]*\/>|{{r\|[^}]+}}|{{rp\|[^}]+}}/gi;
		let m: RegExpExecArray | null;
		while ((m = re.exec(block)) !== null) {
			const raw = m[0];
			if (raw.startsWith('<ref')) tokens.push({ type: 'ref', raw });
			else if (raw.startsWith('{{r|')) tokens.push({ type: 'r', raw });
			else tokens.push({ type: 'rp', raw });
		}
		return tokens;
	};

	/**
	 * Parse an {{rp|...}} template into its parameters.
	 * @param raw - Raw {{rp|...}} template string.
	 * @returns Parsed parameters including page, pages, at, group, and unsupported flag.
	 */
	const parseRp = (raw: string): { page?: string; pages?: string; at?: string; group?: string; unsupported: boolean } => {
		const inner = raw.replace(/^\{\{rp\|/i, '').replace(/\}\}$/, '');
		const params = splitTemplateParams(inner);
		const res: { page?: string; pages?: string; at?: string; group?: string; unsupported: boolean } = { unsupported: false };
		params.forEach((p) => {
			const eq = p.indexOf('=');
			let key = '';
			let val = p;
			if (eq >= 0) {
				key = p.slice(0, eq).trim();
				val = p.slice(eq + 1).trim();
			}
			const norm = key.toLowerCase();
			if (!key || norm === 'p' || norm === 'page') res.page = val;
			else if (norm === 'pp' || norm === 'pages') res.pages = val;
			else if (norm === 'at' || norm === 'location' || norm === 'loc') res.at = val;
			else if (norm === 'group' || norm === 'grp' || norm === 'g') res.group = val;
			else res.unsupported = true;
		});
		return res;
	};

	/**
	 * Extract name and group attributes from a <ref ... /> tag.
	 * @param raw - Raw <ref ... /> tag string.
	 * @returns Object with name and group values or null if not present.
	 */
	const refInfo = (raw: string): { name: string | null; group: string | null } => {
		return { name: extractAttr(raw, 'name'), group: extractAttr(raw, 'group') };
	};

	/**
	 * Parse entries from an {{r|...}} template.
	 * @param raw - Raw {{r|...}} template string.
	 * @returns Array of RTemplateEntry objects or null if invalid.
	 */
	const rEntriesFromR = (raw: string): RTemplateEntry[] | null => {
		const match = raw.match(/^\{\{r\|([\s\S]+)\}\}$/i);
		if (!match) return null;
		const entries = parseRTemplateEntries(match[1]);
		if (entries.some((e) => e.kind === 'other')) return null;
		const nameCount = entries.filter((e) => e.isName).length;
		if (!nameCount) return null;
		if (entries.some((e) => !e.isName && e.index > nameCount)) return null;
		return entries;
	};

	/**
	 * Build an {{r|...}} template string from a chain of references.
	 * @param items - Array of reference items with name, group, page, pages, and at.
	 * @returns Rendered {{r|...}} template string.
	 */
	const buildChain = (items: Array<{
		name: string;
		group?: string | null;
		page?: string;
		pages?: string;
		at?: string;
	}>): string => {
		const params: string[] = [];
		const hasDetail = items.some((it) => it.page || it.pages || it.at);
		items.forEach((it, idx) => {
			const i = idx + 1;
			params.push(it.name);
			if (it.group) {
				if (hasDetail) {
					params.push(i === 1 ? `group=${it.group}` : `group${i}=${it.group}`);
				} else {
					params.push(`group=${it.group}`);
				}
			}
			if (it.page) params.push(i === 1 ? `p=${it.page}` : `p${i}=${it.page}`);
			if (it.pages) params.push(i === 1 ? `pp=${it.pages}` : `pp${i}=${it.pages}`);
			if (it.at) params.push(i === 1 ? `loc=${it.at}` : `loc${i}=${it.at}`);
		});
		return `{{r|${params.join('|')}}}`;
	};

	// Process each matched chain
	return text.replace(chainRegex, (block) => {
		if (block.includes('\n') || block.includes('\r')) {
			return block;
		}
		const trailingWs = block.match(/\s+$/)?.[0] ?? '';
		const trimmedBlock = trailingWs ? block.slice(0, -trailingWs.length) : block;
		const tokens = tokenize(trimmedBlock);
		if (!tokens.length) return block;
		const parts: string[] = [];
		let chain: Array<{ name: string; group?: string | null; page?: string; pages?: string; at?: string }> = [];

		const flushChain = () => {
			if (chain.length) {
				parts.push(buildChain(chain));
				chain = [];
			}
		};

		for (let i = 0; i < tokens.length; i++) {
			const tok = tokens[i];
			if (tok.type === 'ref') {
				const rpTok = tokens[i + 1]?.type === 'rp' ? tokens[i + 1] : null;
				if (rpTok) i++;
				const info = refInfo(tok.raw);
				if (!info.name) {
					flushChain();
					parts.push(tok.raw + (rpTok ? rpTok.raw : ''));
					continue;
				}
				const rp = rpTok ? parseRp(rpTok.raw) : { unsupported: false };
				if (rp.unsupported) {
					flushChain();
					parts.push(tok.raw + (rpTok ? rpTok.raw : ''));
					continue;
				}
				chain.push({
					name: info.name,
					group: info.group,
					page: rp.page,
					pages: rp.pages,
					at: rp.at
				});
				continue;
			}

			if (tok.type === 'r') {
				const rpTok = tokens[i + 1]?.type === 'rp' ? tokens[i + 1] : null;
				if (rpTok) i++;
				const entries = rEntriesFromR(tok.raw);
				if (!entries) {
					flushChain();
					parts.push(tok.raw + (rpTok ? rpTok.raw : ''));
					continue;
				}
				entries
					.filter((e) => e.isName)
					.forEach((e) => {
						const idx = e.index || 1;
						const group = entries.find((en) => en.kind === 'group' && en.index === idx)?.value ?? null;
						const page = entries.find((en) => en.kind === 'page' && en.index === idx)?.value;
						const pages = entries.find((en) => en.kind === 'pages' && en.index === idx)?.value;
						const at = entries.find((en) => en.kind === 'at' && en.index === idx)?.value;
						chain.push({ name: e.value, group, page, pages, at });
					});
				if (rpTok) {
					const rp = parseRp(rpTok.raw);
					if (!rp.unsupported && chain.length) {
						const last = chain[chain.length - 1];
						last.page = rp.page ?? last.page;
						last.pages = rp.pages ?? last.pages;
						last.at = rp.at ?? last.at;
						last.group = rp.group ?? last.group;
					} else {
						flushChain();
						parts.push(tok.raw + rpTok.raw);
					}
				}
				continue;
			}

			// rp without preceding ref/r – flush
			flushChain();
			parts.push(tok.raw);
		}
		flushChain();
		return parts.join(' ') + trailingWs;
	});
}

/**
 * Render an {{r|...}} template from entries, resolving names via references.
 * @param tpl - RTemplate entries to render.
 * @param refs - Map of reference records for name resolution.
 * @param preferTemplateR - Whether to prefer the {{r|...}} template format.
 * @param renameLookup - Optional function to rename reference names.
 * @returns Rendered {{r|...}} template string or null if not renderable.
 */
function renderRTemplate(
	tpl: { entries: RTemplateEntry[] },
	refs: Map<RefKey, RefRecord>,
	preferTemplateR: boolean,
	renameLookup?: (name: string) => string | null | undefined
): string | null {
	const nameEntries = tpl.entries.filter((e) => e.isName);
	if (!nameEntries.length) return null;

	const resolveName = (raw: string): string | null => {
		const ref = refs.get(refKey(raw, null));
		const canonical = ref?.canonical ?? ref;
		const mapped = renameLookup ? renameLookup(raw) : undefined;
		return mapped !== undefined ? mapped : canonical?.name ?? (ref ? null : raw);
	};

	if (preferTemplateR) {
		// Preserve all params; rename names.
		const adjusted = tpl.entries.map((e) => {
			if (!e.isName) return e;
			const next = resolveName(e.value);
			if (!next) return e;
			return { ...e, value: next };
		});
		return buildRTemplateString(adjusted, undefined);
	}

	// Convert to <ref> + optional {{rp}} when lossless; otherwise emit preserved {{r}}.
	const segments: string[] = [];
	const used = new Set<RTemplateEntry>();
	let pendingUnsupported: RTemplateEntry[] = [];

	const flushPending = () => {
		if (!pendingUnsupported.length) return;
		const tplStr = buildRTemplateString(pendingUnsupported, undefined, { renumber: true });
		if (tplStr) segments.push(tplStr);
		pendingUnsupported = [];
	};

	nameEntries.forEach((e, idx) => {
		const idxNum = e.index || idx + 1;
		const relevant = tpl.entries
			.filter((entry) => entry.index === idxNum)
			.filter((entry) => !used.has(entry));
		// Ensure name param is first for stable rendering
		const withoutName = relevant.filter((entry) => entry !== e);
		const orderedRelevant = [e, ...withoutName];
		const mappedRelevant = relevant.map((entry) => {
			if (!entry.isName) return entry;
			const next = resolveName(entry.value);
			return next ? { ...entry, value: next } : entry;
		});
		const hasUnsupported = mappedRelevant.some((entry) => entry.kind === 'other');
		const target = resolveName(e.value);
		if (!target) return;

		if (hasUnsupported) {
			pendingUnsupported.push(...orderedRelevant.map((entry) => {
				if (!entry.isName) return entry;
				const next = resolveName(entry.value);
				return next ? { ...entry, value: next } : entry;
			}));
			orderedRelevant.forEach((entry) => used.add(entry));
			return;
		}

		flushPending();
		const group = mappedRelevant.find((r) => r.kind === 'group' && r.index === idxNum)?.value ?? null;
		const page = mappedRelevant.find((r) => r.kind === 'page' && r.index === idxNum)?.value;
		const pagesEntry = mappedRelevant.find((r) => r.kind === 'pages' && r.index === idxNum);
		const pages = pagesEntry?.value;
		const pagesLabel = pagesEntry?.key && pagesEntry.key.toLowerCase().startsWith('pages') ? 'pages' : 'pp';
		const at = mappedRelevant.find((r) => r.kind === 'at' && r.index === idxNum)?.value;

		let chunk = renderRefSelf(target, group, false);
		const rpParts: string[] = [];
		if (page) rpParts.push(`p=${page}`);
		if (pages) rpParts.push(`${pagesLabel}=${pages}`);
		if (at) rpParts.push(`at=${at}`);
		if (rpParts.length) chunk += `{{rp|${rpParts.join('|')}}}`;
		segments.push(chunk);
		orderedRelevant.forEach((entry) => used.add(entry));
	});

	if (pendingUnsupported.length) {
		const remaining = tpl.entries.filter((entry) => !used.has(entry));
		pendingUnsupported.push(...remaining);
	}
	flushPending();

	return segments.length ? segments.join(' ') : null;
}

/**
 * Normalize a block of content by trimming spaces and collapsing blank lines.
 * @param content - Content block to normalize.
 * @returns Normalized content block.
 */
function normalizeContentBlock(content: string): string {
	let text = String(content ?? '');
	text = text.replace(/[ \t]+\n/g, '\n'); // trim trailing spaces on lines
	text = text.replace(/\n{3,}/g, '\n\n'); // collapse excessive blank lines
	return text.trim();
}

/**
 * Update a reflist template with new refs parameter value.
 * @param tpl - Template match to update.
 * @param ldrEntries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @returns Updated reflist template string.
 */
function updateReflistTemplate(tpl: TemplateMatch, ldrEntries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean): string {
	const params = tpl.params.slice();
	const hasRefsParam = params.some((p) => p.name && p.name.toLowerCase() === 'refs');
	const refsValue = renderRefsValue(ldrEntries, sort);

	if (ldrEntries.length === 0) {
		// Remove refs param if present
		const filtered = params.filter((p) => !(p.name && p.name.toLowerCase() === 'refs'));
		return renderTemplate(tpl.name, filtered);
	}

	if (hasRefsParam) {
		const next = params.map((p) => (p.name && p.name.toLowerCase() === 'refs' ? { ...p, value: refsValue } : p));
		return renderTemplate(tpl.name, next);
	}

	params.push({ name: 'refs', value: refsValue });
	return renderTemplate(tpl.name, params);
}

/**
 * Update a <references> tag with new refs parameter value.
 * @param tag - References tag match to update.
 * @param ldrEntries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @returns Updated references tag string.
 */
function updateReferencesTag(tag: ReferencesTagMatch, ldrEntries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean): string {
	const attrText = tag.attrs ? ` ${tag.attrs}` : '';
	if (ldrEntries.length === 0) {
		return `<references${attrText} />`;
	}
	const refsValue = renderRefsValue(ldrEntries, sort);
	return `<references${attrText}>${refsValue}</references>`;
}

/**
 * Render the value for a refs parameter from entries.
 * @param entries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @returns Rendered refs parameter value.
 */
function renderRefsValue(entries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean): string {
	const sorted = sort ? entries.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, {
		sensitivity: 'base', numeric: true
	})) : entries;
	return '\n' + sorted.map((e) => renderRefTag(e.name, e.group, e.content)).join('\n') + '\n';
}

/**
 * Render a template with given name and parameters.
 * @param name - Template name.
 * @param params - Template parameters.
 * @returns Rendered template string.
 */
function renderTemplate(name: string, params: TemplateParam[]): string {
	const parts = params.map((p) => {
		if (p.name) return `${p.name}=${p.value}`;
		return p.value;
	});
	return `{{${name}${parts.length ? '|' + parts.join('|') : ''}}}`;
}

/**
 * Build an {{r|...}} template string from entries.
 * @param entries - RTemplate entries to include.
 * @param renameLookup - Optional function to rename reference names.
 * @param opts - Options for rendering.
 * @returns Rendered {{r|...}} template string or null if no names present.
 */
function buildRTemplateString(
	entries: RTemplateEntry[],
	renameLookup?: (name: string) => string | null | undefined,
	opts?: { renumber?: boolean }
): string | null {
	if (!entries.some((e) => e.isName)) return null;
	const renumber = Boolean(opts?.renumber);
	const nameIndexMap = new Map<number, number>();
	if (renumber) {
		let counter = 0;
		entries.forEach((e) => {
			if (!e.isName) return;
			if (!nameIndexMap.has(e.index)) {
				nameIndexMap.set(e.index, ++counter);
			}
		});
	}
	const parts: string[] = [];
	entries.forEach((e) => {
		const targetIndex = renumber
			? (nameIndexMap.get(e.index) ?? (nameIndexMap.size ? Math.max(...nameIndexMap.values()) : e.index))
			: e.index;
		let val = e.value;
		if (e.isName) {
			const mapped = renameLookup ? renameLookup(e.value) : undefined;
			val = mapped !== undefined ? (mapped ?? val) : val;
			if (e.key) {
				let keyOut = e.key;
				if (renumber) {
					const base = e.key.replace(/\d+$/, '');
					const hadDigits = base.length !== e.key.length;
					keyOut = hadDigits ? `${base}${targetIndex > 1 ? targetIndex : ''}` : base;
				}
				parts.push(`${keyOut}=${val}`);
			} else {
				parts.push(val);
			}
			return;
		}
		const normalizeKey = (): string | null => {
			if (e.key) {
				if (renumber) {
					const base = e.key.replace(/\d+$/, '');
					const hadDigits = base.length !== e.key.length;
					return hadDigits ? `${base}${targetIndex > 1 ? targetIndex : ''}` : base;
				}
				return e.key;
			}
			return null;
		};
		const explicitKey = normalizeKey();
		if (explicitKey) {
			parts.push(`${explicitKey}=${val}`);
			return;
		}
		const idxSuffix = targetIndex > 1 ? targetIndex.toString() : '';
		const mappedKey =
			e.kind === 'group'
				? 'group'
				: e.kind === 'page'
					? `p${idxSuffix}`
					: e.kind === 'pages'
						? `pp${idxSuffix}`
						: e.kind === 'at'
							? `loc${idxSuffix}`
							: null;
		if (mappedKey) parts.push(`${mappedKey}=${val}`);
	});
	return `{{r|${parts.join('|')}}}`;
}

/**
 * Build a standalone reflist template with given entries.
 * @param entries - List-defined reference entries.
 * @param sort - Whether to sort entries by name.
 * @returns Rendered standalone reflist template string.
 */
function buildStandaloneReflist(entries: Array<{
	name: string; group: string | null; content: string
}>, sort: boolean): string {
	const refsValue = renderRefsValue(entries, sort);
	return `\n{{reflist|refs=${refsValue}}}`;
}

interface Replacement {
	start: number;
	end: number;
	text: string;
}

/**
 * Collapse overlapping replacements by keeping the last one for each range.
 * @param repls - Array of replacements to collapse.
 * @returns Collapsed array of replacements.
 */
function collapseReplacements(repls: Replacement[]): Replacement[] {
	// Remove duplicates and sort
	const filtered = repls.slice().sort((a, b) => b.start - a.start);
	const seen = new Set<string>();
	const result: Replacement[] = [];
	for (const r of filtered) {
		const key = `${r.start}-${r.end}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(r);
	}
	return result;
}

/**
 * Apply a series of replacements to a source string.
 * @param source - Original source string.
 * @param replacements - Array of replacements to apply.
 * @returns Modified string after applying replacements.
 */
function applyReplacements(source: string, replacements: Replacement[]): string {
	let output = source;
	let offset = 0;
	const sorted = replacements.slice().sort((a, b) => a.start - b.start);
	sorted.forEach((r) => {
		const start = r.start + offset;
		const end = r.end + offset;
		output = output.slice(0, start) + r.text + output.slice(end);
		offset += r.text.length - (r.end - r.start);
	});
	return output;
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
