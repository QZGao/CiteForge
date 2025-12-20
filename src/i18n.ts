import rawCatalogues from 'virtual:i18n-catalogues';

type ReplacementValue = string | number;
export type MessageParams = ReplacementValue[];

type CatalogueMap = Record<string, Record<string, string>>;

const catalogues: CatalogueMap = normalizeCatalogues(rawCatalogues);

export type LocaleCode = Extract<keyof typeof catalogues, string>;
export type MessageKey = string;

const fallbackLocale = resolveFallbackLocale();
let activeLocale: LocaleCode = detectInitialLocale();

/**
 * Resolve the most appropriate locale based on the MediaWiki user/content language.
 * Falls back to English if the requested locale is unavailable.
 * @returns The detected locale code.
 */
function detectInitialLocale(): LocaleCode {
	const candidates = getFallbackCandidates();
	for (const candidate of candidates) {
		if (isSupportedLocale(candidate)) {
			return candidate;
		}
	}
	return fallbackLocale;
}

/**
 * Get the list of candidate locales from MediaWiki configuration.
 * @returns Array of locale codes.
 */
function getFallbackCandidates(): string[] {
	const mwFallbackChain = getMwLanguageFallbackChain();
	if (mwFallbackChain.length) {
		return mwFallbackChain;
	}

	const userLang = getMwConfigString('wgUserLanguage');
	const contentLang = getMwConfigString('wgContentLanguage');

	return dedupeLocales([userLang, contentLang]);
}

/**
 * Get the global mw instance if available.
 * @returns mw instance or undefined.
 */
function getMwInstance(): typeof mw | undefined {
	return (globalThis as { mw?: typeof mw }).mw;
}

/**
 * Get a string configuration value from MediaWiki.
 * @param name The configuration key.
 * @returns The configuration value or undefined.
 */
function getMwConfigString(name: string): string | undefined {
	const value = getMwInstance()?.config?.get(name);
	return typeof value === 'string' ? value : undefined;
}

/**
 * Check if a locale code is supported.
 * @param locale - Locale code.
 * @returns True if supported, false otherwise.
 */
function isSupportedLocale(locale: string): locale is LocaleCode {
	return Object.prototype.hasOwnProperty.call(catalogues, locale);
}

/**
 * Resolve the fallback locale to use when no preferred locale is found.
 * Prefers 'en' if available, otherwise picks the first available locale.
 * @returns The fallback locale code.
 */
function resolveFallbackLocale(): LocaleCode {
	if (isSupportedLocale('en')) {
		return 'en';
	}
	const locales = Object.keys(catalogues).filter(isSupportedLocale);
	if (locales.length === 0) {
		throw new Error('[Cite Forge] No i18n catalogues registered');
	}
	return locales[0];
}

/**
 * Resolve a message template for a given key and locale.
 * Falls back to the default locale if the key is not found.
 * @param key - Message key.
 * @param locale - Locale code.
 * @returns The message template string.
 */
function resolveTemplate(key: MessageKey, locale: LocaleCode): string {
	return catalogues[locale]?.[key] ?? catalogues[fallbackLocale]?.[key] ?? key;
}

/**
 * Format a message template with optional parameters.
 * @param template - The message template string.
 * @param params - Optional array of replacement values.
 * @returns The formatted message string.
 */
function format(template: string, params?: MessageParams): string {
	if (!params || params.length === 0) {
		return template;
	}

	return template.replace(/\$(\d+)/g, (_match, rawIndex) => {
		const idx = Number(rawIndex) - 1;
		const value = params[idx];
		return value == null ? '' : String(value);
	});
}

/**
 * Normalize raw catalogue data into the expected structure.
 * @param input - Raw catalogue data.
 * @returns Normalized catalogue map.
 */
function normalizeCatalogues(input: unknown): CatalogueMap {
	if (!isPlainRecord(input)) {
		return {};
	}
	const result: CatalogueMap = {};
	for (const [locale, messages] of Object.entries(input)) {
		if (!isPlainRecord(messages)) {
			continue;
		}
		const safeMessages: Record<string, string> = {};
		for (const [key, value] of Object.entries(messages)) {
			if (typeof value === 'string') {
				safeMessages[key] = value;
			}
		}
		if (Object.keys(safeMessages).length > 0) {
			result[locale] = safeMessages;
		}
	}
	return result;
}

/**
 * Check if a value is a plain object (Record<string, unknown>).
 * @param value - Value to check.
 * @returns True if plain object, false otherwise.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Get the MediaWiki language fallback chain.
 * @returns Array of locale codes.
 */
function getMwLanguageFallbackChain(): string[] {
	const chain = getMwInstance()?.language?.getFallbackLanguageChain?.();
	if (!Array.isArray(chain)) {
		return [];
	}
	return dedupeLocales(chain);
}

/**
 * Deduplicate and normalize an array of locale codes.
 * @param items - Array of locale codes.
 * @returns Deduplicated array of normalized locale codes.
 */
function dedupeLocales(items: Array<string | undefined>): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of items) {
		const normalized = normalizeLocaleCode(raw);
		if (normalized && !seen.has(normalized)) {
			seen.add(normalized);
			result.push(normalized);
		}
	}
	return result;
}

/**
 * Normalize a locale code to lowercase.
 * @param code - Locale code.
 * @returns Normalized locale code or undefined.
 */
function normalizeLocaleCode(code?: string): string | undefined {
	if (!code) {
		return undefined;
	}
	return code.toLowerCase();
}

/**
 * Translate a message key into the active locale, optionally applying parameters.
 */
export function t(key: MessageKey, params?: MessageParams): string {
	const template = resolveTemplate(key, activeLocale);
	return format(template, params);
}

/**
 * Refresh the active locale based on MediaWiki configuration.
 */
export function refreshLocale(): void {
	activeLocale = detectInitialLocale();
}

/**
 * Get the current active locale.
 * @returns The active locale code.
 */
export function getLocale(): LocaleCode {
	return activeLocale;
}
