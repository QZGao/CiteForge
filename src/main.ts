import { parseReferences, attachDomUses } from './core/references';
import { getWikitext } from './data/wikitext_fetch';
import { openInspectorDialog, getPortletLinkId, isHubVisible, setHubVisible } from './ui/panel';
import { addPortletTrigger } from './ui/portlet';
import { namespaceAllowed } from './ui/settings';
import { refreshLocale, t } from './i18n';
import { initColorSchemeSync } from './ui/color_scheme';

initColorSchemeSync();

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
 * Load references and open the Cite Forge inspector dialog.
 * Sets up a refresh callback to reload data when requested.
 */
async function loadCiteForgeData(): Promise<void> {
	const refs = await fetchRefs();
	const refreshOnce = async () => {
		const next = await fetchRefs();
		await openInspectorDialog(next, refreshOnce);
	};
	await openInspectorDialog(refs, refreshOnce);
}

/**
 * Initialize the Cite Forge gadget.
 * Loads dependencies, sets up the portlet link, and optionally opens the panel.
 */
async function init(): Promise<void> {
	await mw.loader.using(['mediawiki.util', 'mediawiki.api', 'mediawiki.language', '@wikimedia/codex']);
	refreshLocale();

	const toggle = async () => {
		if (isHubVisible()) {
			setHubVisible(false);
		} else {
			if (namespaceAllowed()) {
				await loadCiteForgeData();
			} else {
				mw.notify?.(t('main.namespaceMismatch'), { type: 'warn', title: 'Cite Forge' });
			}
			setHubVisible(true);
		}
		refreshPortletLabel();
	};

	const refreshPortletLabel = () => {
		const label = isHubVisible() ? t('ui.portlet.hideCiteForge') : t('ui.portlet.showCiteForge');
		addPortletTrigger(getPortletLinkId(), label, () => {
			void toggle();
		});
	};

	refreshPortletLabel();
	if (isHubVisible()) {
		await loadCiteForgeData();
	}
	mw.hook('wikipage.content').add(() => {
		refreshPortletLabel();
	});
}

void init();
