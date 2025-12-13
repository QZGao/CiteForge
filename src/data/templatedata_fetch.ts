const templateDataOrderCache = new Map<string, string[]>();
const templateDataAliasCache = new Map<string, Record<string, string>>();
const pendingFetches = new Map<string, Promise<void>>();
const STORAGE_KEY = 'citeforge-template-param-order';
let cacheLoaded = false;
const API_ENDPOINT = 'https://zh.wikipedia.org/w/api.php';  // Only used if mw.Api is not available or in tests

function normalizeTemplateName(name: string): string {
	return name.trim().toLowerCase();
}

function canonicalTemplateTitle(name: string): string {
	const trimmed = name.trim().replace(/_/g, ' ');
	return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function normalizeOrder(template: string, order: string[]): string[] {
	const seen = new Set<string>();
	const normalized: string[] = [];
	order.forEach((item) => {
		const key = item.trim().toLowerCase();
		if (!key || seen.has(key)) return;
		seen.add(key);
		normalized.push(key);
	});
	console.info('[Cite Forge][TemplateData] Normalized order', { template, size: normalized.length });
	return normalized;
}

function setTemplateData(name: string, order: string[], aliases: Record<string, string>): void {
	const norm = normalizeTemplateName(name);
	const normalized = normalizeOrder(norm, order);
	templateDataOrderCache.set(norm, normalized);
	templateDataAliasCache.set(norm, aliases);
	saveCache();
}

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

export function getTemplateAliasMap(name: string): Record<string, string> {
	loadCache();
	const key = normalizeTemplateName(name);
	return templateDataAliasCache.get(key) ?? {};
}

export async function fetchTemplateDataOrder(templateName: string): Promise<string[]> {
	const normName = normalizeTemplateName(templateName);
	console.info('[Cite Forge][TemplateData] Requesting param order', { templateName, normName });
	await fetchAndStoreTemplateData(normName);
	return getTemplateParamOrder(normName);
}

export async function ensureTemplateOrders(names: string[]): Promise<void> {
	await Promise.all(names.map((n) => fetchTemplateDataOrder(n)));
}

/**
 * Prefetch TemplateData param order for cite templates present in the provided
 * wikitext so that downstream synchronous normalization can use cached data.
 */
export async function prefetchTemplateDataForWikitext(wikitext: string): Promise<void> {
	const citeRegex = /\{\{\s*([Cc]ite\s+[^\|\}\n\r]+)\s*\|/g;
	const names = new Set<string>();
	let m: RegExpExecArray | null;
	while ((m = citeRegex.exec(wikitext)) !== null) {
		const name = m[1].trim().toLowerCase();
		if (name) names.add(name);
	}
	if (names.size === 0) return;
	await ensureTemplateOrders([...names]);
}

export async function getTemplateParamOrderAsync(name: string): Promise<string[]> {
	loadCache();
	const key = normalizeTemplateName(name);
	const cached = templateDataOrderCache.get(key);
	if (cached) return cached;
	await fetchAndStoreTemplateData(key);
	return getTemplateParamOrder(key);
}

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
			const pagesObj = (data as {
				pages?: Record<
					string,
					{
						paramorder?: string[];
						paramOrder?: string[];
						params?: Record<string, { aliases?: string[] }>;
					}
				>;
			}).pages;
			const pages = pagesObj ? Object.values(pagesObj) : [];
			const orderFromParamOrder =
				pages.find((p) => Array.isArray(p.paramorder) && p.paramorder.length)?.paramorder ||
				pages.find((p) => Array.isArray(p.paramOrder) && p.paramOrder.length)?.paramOrder;
			const paramsPage = pages.find((p) => p.params && Object.keys(p.params).length);
			const orderFromParams = paramsPage?.params ? Object.keys(paramsPage.params) : [];
			let order: string[] = (orderFromParamOrder && orderFromParamOrder.length ? orderFromParamOrder : orderFromParams || []).filter(
				(p) => typeof p === 'string' && p.trim().length > 0
			);
			const aliasMap: Record<string, string> = {};
			if (paramsPage?.params) {
				Object.entries(paramsPage.params).forEach(([paramName, info]) => {
					const aliases = info?.aliases;
					if (Array.isArray(aliases)) {
						aliases.forEach((alias) => {
							const normAlias = alias.trim().toLowerCase();
							if (!normAlias) return;
							aliasMap[normAlias] = paramName.trim().toLowerCase();
						});
					}
				});
			}
			if (order.length) {
				setTemplateData(templateName, order, aliasMap);
				console.info('[Cite Forge][TemplateData] Stored fetched order', {
					templateName,
					size: templateDataOrderCache.get(templateName)?.length ?? order.length,
					order: templateDataOrderCache.get(templateName)
				});
			} else {
				console.info('[Cite Forge][TemplateData] No paramorder found after API', { templateName });
			}
		} catch (err) {
			console.warn('[Cite Forge] Failed to fetch TemplateData order', err);
		}
	})().finally(() => pendingFetches.delete(templateName));
	pendingFetches.set(templateName, promise);
	await promise;
}

function loadCache(): void {
	if (cacheLoaded) return;
	cacheLoaded = true;
	try {
		if (typeof localStorage === 'undefined') return;
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as Record<string, string[] | { order: string[]; aliases?: Record<string, string> }>;
		Object.entries(parsed).forEach(([name, order]) => {
			if (Array.isArray(order)) {
				templateDataOrderCache.set(name, order);
				templateDataAliasCache.set(name, {});
			} else if (order && Array.isArray(order.order)) {
				const norm = normalizeTemplateName(name);
				templateDataOrderCache.set(norm, order.order);
				templateDataAliasCache.set(norm, order.aliases ?? {});
			}
		});
		console.info('[Cite Forge][TemplateData] Loaded cache from storage', { size: templateDataOrderCache.size });
	} catch (err) {
		console.warn('[Cite Forge][TemplateData] Failed to load cache', err);
	}
}

function saveCache(): void {
	try {
		if (typeof localStorage === 'undefined') return;
		const obj: Record<string, { order: string[]; aliases: Record<string, string> }> = {};
		templateDataOrderCache.forEach((order, name) => {
			obj[name] = { order, aliases: templateDataAliasCache.get(name) ?? {} };
		});
		localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
	} catch (err) {
		console.warn('[Cite Forge][TemplateData] Failed to save cache', err);
	}
}
