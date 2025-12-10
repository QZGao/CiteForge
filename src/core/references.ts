import { Reference } from '../types';

/**
 * Parse wikitext for basic ref usages.
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
 * Attach DOM anchor nodes to known references where possible.
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

function extractAttr(attrs: string, attrName: string): string | null {
	const regex = new RegExp(`${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
	const match = attrs.match(regex);
	if (!match) return null;
	return match[1] ?? match[2] ?? match[3] ?? null;
}

function sanitizeWikitext(text: string): string {
	let t = String(text || '');
	t = t.replace(/<!--[\s\S]*?-->/g, '');
	t = t.replace(/<nowiki\b[^>]*>[\s\S]*?<\/nowiki>/gi, '');
	t = t.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/gi, '');
	t = t.replace(/<syntaxhighlight\b[^>]*>[\s\S]*?<\/syntaxhighlight>/gi, '');
	t = t.replace(/<nowiki\b[^>]*\/\s*>/gi, '');
	return t;
}

function stripSelfClosingRefs(text: string): string {
	return text.replace(/<ref\b[^>]*\bname\s*=\s*(?:"[^"]+"|'[^']+'|[^\s\/>]+)[^>]*\/\s*>/gi, '');
}
