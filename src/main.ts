import styles from './styles.css';
import { parseReferences, attachDomUses } from './core/references';
import { getWikitext } from './data/wikitext';
import { injectStyles } from './utils/styles';
import { openInspectorDialog, getPortletLinkId, isHubVisible, setHubVisible } from './ui/panel';
import { addPortletTrigger } from './ui/portlet';

/**
 * Fetch and parse references from the current page's wikitext.
 * Also attaches DOM anchor elements to each reference use.
 * @returns Array of parsed references with DOM anchors attached.
 */
async function fetchRefs(): Promise<import('./types').Reference[]> {
	const wikitext = await getWikitext();
	const refs = parseReferences(wikitext);
	attachDomUses(refs);
	return refs;
}

/**
 * Load references and open the Cite Hub inspector dialog.
 * Sets up a refresh callback to reload data when requested.
 */
async function loadCiteHubData(): Promise<void> {
	const refs = await fetchRefs();
	const refreshOnce = async () => {
		const next = await fetchRefs();
		await openInspectorDialog(next, refreshOnce);
	};
	await openInspectorDialog(refs, refreshOnce);
}

/**
 * Initialize the Cite Hub gadget.
 * Injects styles, sets up the portlet link, and optionally opens the panel.
 */
async function init(): Promise<void> {
	injectStyles(styles);
	await mw.loader.using(['mediawiki.util', 'mediawiki.api', '@wikimedia/codex']);

	const toggle = async () => {
		if (isHubVisible()) {
			setHubVisible(false);
		} else {
			await loadCiteHubData();
			setHubVisible(true);
		}
		refreshPortletLabel();
	};

	const refreshPortletLabel = () => {
		const label = isHubVisible() ? 'Hide Cite Hub' : 'Show Cite Hub';
		addPortletTrigger(getPortletLinkId(), label, () => {
			void toggle();
		});
	};

	refreshPortletLabel();
	if (isHubVisible()) {
		await loadCiteHubData();
	}
	mw.hook('wikipage.content').add(() => {
		refreshPortletLabel();
	});
}

void init();
