import { parseReferences, attachDomUses } from '../core/references';
import { getWikitext } from '../data/wikitext_fetch';
import { Reference } from '../types';
import { openInspectorDialog, setHubVisible, isHubVisible, getInspectorRoot, jumpToInspectorAnchor } from './panel';

let inFlightRefs: Promise<Reference[]> | null = null;

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
