import { Reference } from '../types';

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
		const key = name ?? `__nameless_${namelessCounter}`;
		const existing = refs.get(key);

		if (existing) {
			if (content && !existing.contentWikitext) {
				existing.contentWikitext = content;
			}
			return existing;
		}

		const ref: Reference = {
			id: key,
			name,
			group,
			contentWikitext: content,
			uses: []
		};
		refs.set(key, ref);
		return ref;
	};

	const sanitized = sanitizeWikitext(wikitext);
	const withoutSelfClosing = stripSelfClosingRefs(sanitized);

	// Capture named <ref>...</ref> content from sanitized text
	const refTagRegex = /<ref\b[^>]*\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s/>]+))[^>]*>([\s\S]*?)<\/ref>/gi;
	let match: RegExpExecArray | null;
	while ((match = refTagRegex.exec(withoutSelfClosing)) !== null) {
		const name = match[1] ?? match[2] ?? match[3] ?? '';
		const content = match[4] ?? '';
		const group = extractAttr(match[0], 'group');
		if (!name) {
			namelessCounter++;
		}
		const ref = getOrCreateRef(name || null, group, content.trim());
		ref.uses.push({ index: ref.uses.length, anchor: null });
	}

	const refSelfClosing = /<ref\b([^>]*)\/>/gi;
	while ((match = refSelfClosing.exec(wikitext)) !== null) {
		const attrs = match[1] ?? '';
		const name = extractAttr(attrs, 'name');
		const group = extractAttr(attrs, 'group');
		if (!name) {
			namelessCounter++;
		}
		const ref = getOrCreateRef(name, group, '');
		ref.uses.push({ index: ref.uses.length, anchor: null });
	}

	// Count full refs as uses on original text
	const refTagUses = /<ref\b([^>]*)>([\s\S]*?)<\/ref>/gi;
	while ((match = refTagUses.exec(wikitext)) !== null) {
		const attrs = match[1] ?? '';
		const content = match[2] ?? '';
		const name = extractAttr(attrs, 'name');
		const group = extractAttr(attrs, 'group');
		if (!name) {
			namelessCounter++;
		}
		const ref = getOrCreateRef(name, group, content.trim());
		ref.uses.push({ index: ref.uses.length, anchor: null });
	}

	const refTemplate = /\{\{\s*r\s*\|\s*(?:name\s*=\s*)?([^|}]+)[^}]*\}\}/gi;
	while ((match = refTemplate.exec(wikitext)) !== null) {
		const name = match[1]?.trim();
		if (!name) continue;
		const ref = getOrCreateRef(name, null, '');
		ref.uses.push({ index: ref.uses.length, anchor: null });
	}

	return Array.from(refs.values());
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
function extractAttr(attrs: string, attrName: string): string | null {
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
 * Remove self-closing named ref tags from wikitext.
 * Used to avoid double-counting when parsing full ref tags separately.
 * @param text - Wikitext to process.
 * @returns Wikitext with self-closing named refs removed.
 */
function stripSelfClosingRefs(text: string): string {
	return text.replace(/<ref\b[^>]*\bname\s*=\s*(?:"[^"]+"|'[^']+'|[^\s\/>]+)[^>]*\/\s*>/gi, '');
}
