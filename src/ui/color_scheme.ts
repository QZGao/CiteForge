const SKIN_DAY_CLASS = 'skin-theme-clientpref-day';
const SKIN_NIGHT_CLASS = 'skin-theme-clientpref-night';
const SKIN_OS_CLASS = 'skin-theme-clientpref-os';

export type ColorScheme = 'day' | 'night';
type SkinPreference = ColorScheme | 'os';

export const COLOR_SCHEME_DAY_CLASS = 'citeforge-theme-day';
export const COLOR_SCHEME_NIGHT_CLASS = 'citeforge-theme-night';

let initialized = false;
let appliedScheme: ColorScheme | null = null;
let mediaQueryList: MediaQueryList | null = null;
let systemPreferenceCleanup: (() => void) | null = null;
let activeApply: (() => void) | null = null;

/**
 * Handle system color scheme changes and reapply detected classes.
 */
const systemPreferenceChangeHandler = (): void => {
	activeApply?.();
};

/**
 * Read the current MediaWiki skin preference from the root element classes.
 * @param root - The document root element (<html>) that holds the skin classes.
 * @returns The preferred scheme: 'day', 'night', or 'os' to defer to the OS.
 */
const getSkinPreference = (root: HTMLElement): SkinPreference => {
	if (root.classList.contains(SKIN_NIGHT_CLASS)) {
		return 'night';
	}
	if (root.classList.contains(SKIN_DAY_CLASS)) {
		return 'day';
	}
	if (root.classList.contains(SKIN_OS_CLASS)) {
		return 'os';
	}
	return 'os';
};

/**
 * Convert a skin preference into a resolved day/night scheme.
 * @param preference - The skin preference (explicit or OS-backed).
 * @returns 'day' or 'night' based on the preference and OS state.
 */
const computeScheme = (preference: SkinPreference): ColorScheme => {
	if (preference === 'os') {
		return mediaQueryList?.matches ? 'night' : 'day';
	}
	return preference;
};

/**
 * Apply Cite Forge theme classes to reflect the resolved scheme.
 * @param root - The document root element to tag.
 * @param scheme - Either 'day' or 'night' to enable.
 */
const setSchemeClass = (root: HTMLElement, scheme: ColorScheme): void => {
	if (appliedScheme === scheme) return;
	appliedScheme = scheme;
	root.classList.toggle(COLOR_SCHEME_DAY_CLASS, scheme === 'day');
	root.classList.toggle(COLOR_SCHEME_NIGHT_CLASS, scheme === 'night');
};

/**
 * Manage matchMedia listeners so we react to OS color scheme changes only when needed.
 * @param preference - Current skin preference that may require listening to OS changes.
 */
const syncSystemPreferenceListener = (preference: SkinPreference): void => {
	const mq = mediaQueryList;
	if (!mq) return;
	if (preference === 'os') {
		if (systemPreferenceCleanup) return;
		if ('addEventListener' in mq) {
			const target = mq as MediaQueryList & EventTarget;
			target.addEventListener('change', systemPreferenceChangeHandler);
			systemPreferenceCleanup = () => {
				target.removeEventListener('change', systemPreferenceChangeHandler);
			};
		} else if ('addListener' in mq) {
			const target = mq as MediaQueryList & { addListener: (listener: () => void) => void; removeListener: (listener: () => void) => void };
			target.addListener(systemPreferenceChangeHandler);
			systemPreferenceCleanup = () => {
				target.removeListener(systemPreferenceChangeHandler);
			};
		}
	} else if (systemPreferenceCleanup) {
		systemPreferenceCleanup();
		systemPreferenceCleanup = null;
	}
};

/**
 * Evaluate the DOM and apply classes that reflect the latest preference.
 * @param root - The document root element to inspect and tag.
 */
const applySchemeFromDom = (root: HTMLElement): void => {
	const preference = getSkinPreference(root);
	const nextScheme = computeScheme(preference);
	setSchemeClass(root, nextScheme);
	syncSystemPreferenceListener(preference);
};

/**
 * Initialize observers that keep Cite Forge theme classes in sync with the skin or OS preference.
 */
export const initColorSchemeSync = (): void => {
	if (initialized) return;
	const root = document.documentElement;
	if (!root) return;

	mediaQueryList = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
		? window.matchMedia('(prefers-color-scheme: dark)')
		: null;

	const apply = () => applySchemeFromDom(root);
	activeApply = apply;
	apply();

	if (typeof MutationObserver === 'function') {
		const observer = new MutationObserver((mutations) => {
			if (mutations.some((mutation) => mutation.attributeName === 'class')) {
				apply();
			}
		});
		observer.observe(root, { attributes: true, attributeFilter: ['class'] });
	}

	initialized = true;
};
