import { getPortletLinkId, isHubVisible, setHubVisible } from './ui/panel';
import { addPortletTrigger } from './ui/portlet';
import { namespaceAllowed } from './ui/settings';
import { refreshLocale, t } from './i18n';
import { initColorSchemeSync } from './ui/color_scheme';
import { initCitationPopup, initReferencePopup } from './ui/citations';
import { loadInspectorData } from './ui/inspector_loader';

initColorSchemeSync();

/**
 * Initialize the Cite Forge gadget.
 * Loads dependencies, sets up the portlet link, and optionally opens the panel.
 */
async function init(): Promise<void> {
	await mw.loader.using(['mediawiki.util', 'mediawiki.api', 'mediawiki.language', '@wikimedia/codex']);
	refreshLocale();
	initCitationPopup();
	initReferencePopup();

	const toggle = async () => {
		if (isHubVisible()) {
			setHubVisible(false);
		} else {
			if (namespaceAllowed()) {
				await loadInspectorData();
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
		await loadInspectorData();
	}
	mw.hook('wikipage.content').add(() => {
		refreshPortletLabel();
	});
}

void init();
