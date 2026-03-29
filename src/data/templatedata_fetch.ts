const templateDataOrderCache = new Map<string, string[]>();
const templateDataAliasCache = new Map<string, Record<string, string>>();
const templateDataCitoidMapCache = new Map<string, TemplateCitoidMap>();
const pendingFetches = new Map<string, Promise<void>>();
const pendingCitoidMapFetches = new Map<string, Promise<void>>();
const STORAGE_KEY = 'citeforge-template-param-order';
let cacheLoaded = false;
const API_ENDPOINT = 'https://zh.wikipedia.org/w/api.php';  // Only used if mw.Api is not available or in tests
const ENWIKI_API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

export type TemplateCitoidMap = Record<string, unknown>;
type TemplateDataPage = {
	paramorder?: string[];
	paramOrder?: string[];
	params?: Record<string, { aliases?: string[] }>;
	maps?: { citoid?: TemplateCitoidMap };
};

/**
 * Normalize a template name for consistent caching.
 * @param name - Template name.
 * @returns Normalized template name.
 */
function normalizeTemplateName(name: string): string {
	return name.trim().replace(/[_\s]+/g, ' ').toLowerCase();
}

/**
 * Normalize a TemplateData parameter key for cache storage and lookup.
 * TemplateData can differ between wikis on whether it uses underscores or hyphens.
 * @param name - Raw TemplateData parameter key.
 * @returns Normalized key.
 */
function normalizeTemplateParamKey(name: string): string {
	return name.trim().toLowerCase().replace(/[_-]+/g, '-');
}

/**
 * Convert a template name to its canonical title form.
 * @param name - Template name.
 * @returns Canonical template title.
 */
function canonicalTemplateTitle(name: string): string {
	const trimmed = name.trim().replace(/_/g, ' ');
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/**
 * Normalize the parameter order array by trimming, lowercasing, and deduplicating.
 * @param template - Template name for logging.
 * @param order - Raw parameter order array.
 * @returns Normalized parameter order array.
 */
function normalizeOrder(template: string, order: string[]): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];
	order.forEach((item) => {
		const key = normalizeTemplateParamKey(item);
		if (!key || seen.has(key)) return;
		seen.add(key);
		normalized.push(key);
	});
	console.info('[Cite Forge][TemplateData] Normalized order', { template, size: normalized.length });
	return normalized;
}

/**
 * Normalize a TemplateData alias map for cache storage and lookup.
 * @param aliases - Raw alias map.
 * @returns Normalized alias map.
 */
function normalizeAliasMap(aliases: Record<string, string>): Record<string, string> {
	const normalized: Record<string, string> = {};
	Object.entries(aliases).forEach(([alias, canonical]) => {
		const normAlias = normalizeTemplateParamKey(alias);
		const normCanonical = normalizeTemplateParamKey(canonical);
		if (!normAlias || !normCanonical) return;
		normalized[normAlias] = normCanonical;
	});
	return normalized;
}

/**
 * Store template data in the cache and persist.
 * @param name - Template name.
 * @param order - Parameter order array.
 * @param aliases - Parameter alias map.
 * @param citoidMap - Optional Citoid parameter map.
 */
function setTemplateData(name: string, order: string[], aliases: Record<string, string>, citoidMap: TemplateCitoidMap | null): void {
	const norm = normalizeTemplateName(name);
	const normalized = normalizeOrder(norm, order);
	templateDataOrderCache.set(norm, normalized);
	templateDataAliasCache.set(norm, normalizeAliasMap(aliases));
	if (citoidMap) {
		templateDataCitoidMapCache.set(norm, citoidMap);
	} else {
		templateDataCitoidMapCache.delete(norm);
	}
	saveCache();
}

/**
 * Get the parameter order for a template from cache.
 * @param name - Template name.
 * @returns Parameter order array or empty array if not found.
 */
export function getTemplateParamOrder(name: string): string[] {
	loadCache();
	const key = normalizeTemplateName(name);
	const cached = templateDataOrderCache.get(key);
	if (cached) {
		console.info('[Cite Forge][TemplateData] Cache hit', { name: key, size: cached.length });
		return cached;
	}
	console.info('[Cite Forge][TemplateData] No order found', { name: key });
	return [];
}

/**
 * Get the parameter alias map for a template from cache.
 * @param name - Template name.
 * @returns Parameter alias map.
 */
export function getTemplateAliasMap(name: string): Record<string, string> {
	loadCache();
	const key = normalizeTemplateName(name);
	return templateDataAliasCache.get(key) ?? {};
}

/**
 * Get the cached Citoid-to-template parameter map for a template.
 * @param name - Template name.
 * @returns Citoid map or null if unavailable.
 */
export function getTemplateCitoidMap(name: string): TemplateCitoidMap | null {
	loadCache();
	const key = normalizeTemplateName(name);
	return templateDataCitoidMapCache.get(key) ?? null;
}

/**
 * Fetch and return the parameter order for a template, caching the result.
 * @param templateName - Template name.
 * @returns Parameter order array.
 */
export async function fetchTemplateDataOrder(templateName: string): Promise<string[]> {
	const normName = normalizeTemplateName(templateName);
	console.info('[Cite Forge][TemplateData] Requesting param order', { templateName, normName });
	await fetchAndStoreTemplateData(normName);
	return getTemplateParamOrder(normName);
}

/**
 * Fetch and return the Citoid parameter map for a template, caching the result.
 * @param templateName - Template name.
 * @returns Citoid parameter map or null when unavailable.
 */
export async function fetchTemplateDataCitoidMap(templateName: string): Promise<TemplateCitoidMap | null> {
	const normName = normalizeTemplateName(templateName);
	console.info('[Cite Forge][TemplateData] Requesting citoid map', { templateName, normName });
	await fetchAndStoreEnwikiCitoidMap(normName);
	return getTemplateCitoidMap(normName);
}

/**
 * Ensure TemplateData param orders are cached for the given template names.
 * @param names - Array of template names.
 */
export async function ensureTemplateOrders(names: string[]): Promise<void> {
	await Promise.all(names.map((n) => fetchTemplateDataOrder(n)));
}

/**
 * Prefetch TemplateData param order for cite templates present in the provided
 * wikitext so that downstream synchronous normalization can use cached data.
 */
export async function prefetchTemplateDataForWikitext(wikitext: string): Promise<void> {
	const citeRegex = /\{\{\s*([Cc]ite(?:[\s_]+)[^\|\}\n\r]+)\s*\|/g;
	const names = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = citeRegex.exec(wikitext)) !== null) {
		const name = normalizeTemplateName(m[1]);
		if (name) names.add(name);
	}
	if (names.size === 0) return;
	await ensureTemplateOrders([...names]);
}

/**
 * Fetch TemplateData for a template and store in cache.
 * @param templateName - Template name.
 */
async function fetchAndStoreTemplateData(templateName: string): Promise<void> {
	loadCache();
	if (pendingFetches.has(templateName)) {
		await pendingFetches.get(templateName);
		return;
	}
	const promise = (async () => {
		try {
			// Skip if already cached
			const existing = templateDataOrderCache.get(templateName);
			if (existing) {
				console.info('[Cite Forge][TemplateData] Using cached param order', { templateName, size: existing.length });
				return;
			}
			const mwApiCtor = (globalThis as unknown as { mw?: typeof mw }).mw?.Api;
			let data: unknown;
			if (mwApiCtor) {
				const api = new mwApiCtor();
				const title = `Template:${canonicalTemplateTitle(templateName).replace(/\s+/g, '_')}`;
				console.info('[Cite Forge][TemplateData] Fetching via mw.Api', { title });
				data = await api.get({
					action: 'templatedata',
					titles: title,
					redirects: true,
					formatversion: 2
				});
			} else if (typeof fetch === 'function') {
				const title = encodeURIComponent(`Template:${canonicalTemplateTitle(templateName)}`);
				const url = `${API_ENDPOINT}?action=templatedata&titles=${title}&redirects=true&formatversion=2&format=json&origin=*`;
				console.info('[Cite Forge][TemplateData] Fetching via http fetch', { url });
				const resp = await fetch(url);
				data = await resp.json();
			} else {
				console.info('[Cite Forge][TemplateData] No mw.Api or fetch available; skipping fetch', { templateName });
				return;
			}
			console.info('[Cite Forge][TemplateData] API response', data);
			const pages = getTemplateDataPages(data);
			const orderFromParamOrder =
				pages.find((p) => Array.isArray(p.paramorder) && p.paramorder.length)?.paramorder ||
				pages.find((p) => Array.isArray(p.paramOrder) && p.paramOrder.length)?.paramOrder;
			const paramsPage = pages.find((p) => p.params && Object.keys(p.params).length);
			const citoidMapPage = pages.find((p) => isTemplateCitoidMap(p.maps?.citoid));
			const orderFromParams = paramsPage?.params ? Object.keys(paramsPage.params) : [];
			let order: string[] = (orderFromParamOrder && orderFromParamOrder.length ? orderFromParamOrder : orderFromParams || []).filter(
				(p) => p.trim().length > 0
			);
			const aliasMap: Record<string, string> = {};
			const citoidMap = citoidMapPage?.maps?.citoid && isTemplateCitoidMap(citoidMapPage.maps.citoid) ? citoidMapPage.maps.citoid : null;
			if (paramsPage?.params) {
				Object.entries(paramsPage.params).forEach(([paramName, info]) => {
					const canonicalName = normalizeTemplateParamKey(paramName);
					if (!canonicalName) return;
					const aliases = info?.aliases;
					if (Array.isArray(aliases)) {
						aliases.forEach((alias) => {
							const normAlias = normalizeTemplateParamKey(alias);
							if (!normAlias) return;
							aliasMap[normAlias] = canonicalName;
						});
					}
				});
			}
			if (order.length || citoidMap) {
				setTemplateData(templateName, order, aliasMap, citoidMap);
				console.info('[Cite Forge][TemplateData] Stored fetched order', {
					templateName,
					size: templateDataOrderCache.get(templateName)?.length ?? order.length,
					order: templateDataOrderCache.get(templateName),
					hasCitoidMap: Boolean(citoidMap)
				});
			} else {
				console.info('[Cite Forge][TemplateData] No paramorder or citoid map found after API', { templateName });
			}
		} catch (err) {
			console.warn('[Cite Forge] Failed to fetch TemplateData order', err);
		}
	})().finally(() => pendingFetches.delete(templateName));
	pendingFetches.set(templateName, promise);
	await promise;
}

/**
 * Fetch the TemplateData Citoid map for a template from English Wikipedia.
 * This is separate from the general TemplateData cache because many local
 * wikis do not expose the same Citoid mappings as enwiki.
 * @param templateName - Normalized template name.
 */
async function fetchAndStoreEnwikiCitoidMap(templateName: string): Promise<void> {
	loadCache();
	if (templateDataCitoidMapCache.has(templateName)) return;
	if (pendingCitoidMapFetches.has(templateName)) {
		await pendingCitoidMapFetches.get(templateName);
		return;
	}

	const promise = (async () => {
		try {
			if (typeof fetch !== 'function') {
				console.info('[Cite Forge][TemplateData] No fetch available for enwiki citoid map request', { templateName });
				return;
			}

			const title = encodeURIComponent(`Template:${canonicalTemplateTitle(templateName)}`);
			const url = `${ENWIKI_API_ENDPOINT}?action=templatedata&titles=${title}&redirects=true&formatversion=2&format=json&origin=*`;
			console.info('[Cite Forge][TemplateData] Fetching citoid map from enwiki', { templateName, url });
			const resp = await fetch(url);
			const data = (await resp.json()) as unknown;
			console.info('[Cite Forge][TemplateData] Enwiki citoid map response', data);

			const pages = getTemplateDataPages(data);
			const citoidMapPage = pages.find((page) => isTemplateCitoidMap(page.maps?.citoid));
			const citoidMap = citoidMapPage?.maps?.citoid && isTemplateCitoidMap(citoidMapPage.maps.citoid) ? citoidMapPage.maps.citoid : null;

			if (!citoidMap) {
				console.info('[Cite Forge][TemplateData] No enwiki citoid map found', { templateName });
				return;
			}

			templateDataCitoidMapCache.set(templateName, citoidMap);
			saveCache();
			console.info('[Cite Forge][TemplateData] Stored enwiki citoid map', { templateName });
		} catch (err) {
			console.warn('[Cite Forge] Failed to fetch TemplateData citoid map from enwiki', err);
		}
	})().finally(() => pendingCitoidMapFetches.delete(templateName));

	pendingCitoidMapFetches.set(templateName, promise);
	await promise;
}

/**
 * Extract the TemplateData pages list from an API response.
 * @param data - Raw TemplateData API response.
 * @returns Page objects from the response.
 */
function getTemplateDataPages(data: unknown): TemplateDataPage[] {
	const pagesObj = (data as { pages?: Record<string, TemplateDataPage> }).pages;
	return pagesObj ? Object.values(pagesObj) : [];
}

/**
 * Load cached template data from localStorage.
 */
function loadCache(): void {
	if (cacheLoaded) return;
	cacheLoaded = true;
	try {
		if (typeof localStorage === 'undefined') return;
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Record<
			string,
			string[] | { order: string[]; aliases?: Record<string, string>; citoid?: TemplateCitoidMap }
		>;
		Object.entries(parsed).forEach(([name, order]) => {
			const norm = normalizeTemplateName(name);
			if (Array.isArray(order)) {
				templateDataOrderCache.set(norm, normalizeOrder(norm, order));
				templateDataAliasCache.set(norm, {});
			} else if (order && Array.isArray(order.order)) {
				templateDataOrderCache.set(norm, normalizeOrder(norm, order.order));
				templateDataAliasCache.set(norm, normalizeAliasMap(order.aliases ?? {}));
				if (isTemplateCitoidMap(order.citoid)) {
					templateDataCitoidMapCache.set(norm, order.citoid);
				}
			}
		});
		console.info('[Cite Forge][TemplateData] Loaded cache from storage', { size: templateDataOrderCache.size });
	} catch (err) {
		console.warn('[Cite Forge][TemplateData] Failed to load cache', err);
	}
}

/**
 * Save cached template data to localStorage.
 */
function saveCache(): void {
	try {
		if (typeof localStorage === 'undefined') return;
		const obj: Record<string, { order: string[]; aliases: Record<string, string>; citoid?: TemplateCitoidMap }> = {};
		const names = new Set([
			...templateDataOrderCache.keys(),
			...templateDataAliasCache.keys(),
			...templateDataCitoidMapCache.keys()
		]);
		names.forEach((name) => {
			const order = templateDataOrderCache.get(name) ?? [];
			const citoidMap = templateDataCitoidMapCache.get(name);
			obj[name] = {
				order,
				aliases: templateDataAliasCache.get(name) ?? {},
				...(citoidMap ? { citoid: citoidMap } : {})
			};
		});
		localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
	} catch (err) {
		console.warn('[Cite Forge][TemplateData] Failed to save cache', err);
	}
}

/**
 * Check whether a value looks like a TemplateData Citoid map object.
 * @param value - Candidate map value.
 * @returns True when the value is a plain object.
 */
function isTemplateCitoidMap(value: unknown): value is TemplateCitoidMap {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
