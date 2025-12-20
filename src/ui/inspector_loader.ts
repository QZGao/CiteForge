import {parseReferences} from '../core/parse_wikitext';
import {getWikitext} from '../data/wikitext_fetch';
import {Reference} from '../types';
import {getInspectorRoot, isHubVisible, jumpToInspectorAnchor, openInspectorDialog, setHubVisible} from './panel';
import {escapeRegex} from "../core/string_utils";

let inFlightRefs: Promise<Reference[]> | null = null;

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
            const variants = buildRefIdVariants(name);
            if (variants.some((variant) => hrefMatchesReference(href, variant))) {
                const cursor = attachCursor.get(name) ?? 0;
                if (cursor < ref.uses.length) {
                    ref.uses[cursor].anchor = anchor;
                    attachCursor.set(name, cursor + 1);
                } else {
                    ref.uses.push({index: ref.uses.length, anchor});
                }
                const sup = anchor.closest('sup.reference');
                if (sup instanceof HTMLElement) {
                    sup.dataset.citeforgeRefId = ref.id;
                }
                if (anchor instanceof HTMLElement) {
                    anchor.dataset.citeforgeRefId = ref.id;
                }
                applyRefIdToReferenceEntry(anchor, ref.id);
            }
        });
    });
}

/**
 * Build possible ID variants for a reference name.
 * Generates different forms to match against hrefs.
 * @param name - The reference name.
 * @returns Array of variant strings.
 */
function buildRefIdVariants(name: string): string[] {
    const variants = new Set<string>();
    variants.add(name);
    variants.add(name.replace(/ /g, '_'));
    variants.add(encodeURIComponent(name));
    return Array.from(variants).filter((variant) => Boolean(variant));
}

/**
 * Check if an href matches a reference variant.
 * @param href - The href attribute value from an anchor.
 * @param variant - The reference variant to match against.
 * @returns True if it matches, false otherwise.
 */
function hrefMatchesReference(href: string, variant: string): boolean {
    if (!variant) return false;
    const target = href.replace(/^#/, '');
    if (!target) return false;
    const pattern = new RegExp(`^cite_(?:note|ref)-${escapeRegex(variant)}(?:-[0-9]+(?:-[0-9]+)?)?$`, 'i');
    return pattern.test(target);
}

/**
 * Apply the citeforgeRefId data attribute to the reference entry element.
 * @param anchor - The anchor element linking to the reference.
 * @param refId - The reference ID to apply.
 */
function applyRefIdToReferenceEntry(anchor: Element, refId: string): void {
    const href = anchor.getAttribute('href');
    if (!href) return;
    const targetId = href.replace(/^#/, '');
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (target instanceof HTMLElement) {
        target.dataset.citeforgeRefId = refId;
    }
}

/**
 * Fetch and parse references from the current page.
 * @return Array of Reference objects.
 */
async function fetchRefsInternal(): Promise<Reference[]> {
	const wikitext = await getWikitext();
	const refs = parseReferences(wikitext);
	attachDomUses(refs);
	return refs;
}

/**
 * Fetch and parse references from the current page, reusing in-flight work.
 */
export async function fetchInspectorRefs(): Promise<Reference[]> {
	if (!inFlightRefs) {
		const pending = fetchRefsInternal();
		inFlightRefs = pending;
		try {
			return await pending;
		} finally {
			if (inFlightRefs === pending) {
				inFlightRefs = null;
			}
		}
	}
	return inFlightRefs;
}

/**
 * Load references and open the inspector dialog, wiring a refresh callback.
 */
export async function loadInspectorData(): Promise<void> {
	const refs = await fetchInspectorRefs();
	const refreshOnce = async () => {
		const next = await fetchInspectorRefs();
		await openInspectorDialog(next, refreshOnce);
	};
	await openInspectorDialog(refs, refreshOnce);
}

async function ensureInspectorMounted(): Promise<void> {
	if (!getInspectorRoot()) {
		await loadInspectorData();
	}
	if (!isHubVisible()) {
		setHubVisible(true);
	}
	// If the inspector root exists, ensure the panel is opened so backward
	// jumps reliably target the selected entry.
	const root = getInspectorRoot();
	if (root) {
		const r = root as unknown as Record<string, unknown>;
		const maybeSetOpen = r.setOpen;
		if (typeof maybeSetOpen === 'function') {
			try {
				(maybeSetOpen as (flag: boolean) => void).call(root, true);
			} catch {
				/* ignore */
			}
		}
	}
}

/**
 * Ensure the inspector is open and jump to the target citation anchor.
 */
export async function jumpToInspectorTarget(targetId: string): Promise<boolean> {
	if (!targetId) return false;
	await ensureInspectorMounted();
	let jumped = jumpToInspectorAnchor(targetId);
	if (jumped) {
		return true;
	}
	await loadInspectorData();
	jumped = jumpToInspectorAnchor(targetId);
	return jumped;
}
