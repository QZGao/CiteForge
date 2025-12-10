type Settings = {
	copyFormat: 'raw' | 'r' | 'ref';
	showCiteRefCopyBtn: boolean;
	showInUserNs: boolean;
};

const SETTINGS_KEY = 'citehub-settings';
let cachedSettings: Settings | null = null;

const DEFAULT_SETTINGS: Settings = {
	copyFormat: 'raw',
	showCiteRefCopyBtn: true,
	showInUserNs: true
};

export function loadSettings(): Settings {
	if (cachedSettings) return cachedSettings;
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) {
			cachedSettings = { ...DEFAULT_SETTINGS };
			return cachedSettings;
		}
		const parsed = JSON.parse(raw) as Partial<Settings>;
		cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
		return cachedSettings;
	} catch {
		cachedSettings = { ...DEFAULT_SETTINGS };
		return cachedSettings;
	}
}

export function saveSettings(next: Partial<Settings>): void {
	const current = loadSettings();
	cachedSettings = { ...current, ...next };
	try {
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(cachedSettings));
	} catch {
		/* ignore */
	}
}

export function getSettings(): Settings {
	return loadSettings();
}

export function namespaceAllowed(): boolean {
	const ns = mw.config?.get('wgNamespaceNumber');
	const nsIds = mw.config?.get('wgNamespaceIds') || {};
	const allowed = ns === 0 || ns === 2 || (typeof nsIds?.draft === 'number' && ns === nsIds.draft);
	if (!allowed) return false;
	if (ns === 2) {
		const s = getSettings();
		if (!s.showInUserNs) return false;
	}
	const cm = mw.config?.get('wgPageContentModel');
	if (cm && cm !== 'wikitext') return false;
	return true;
}
