import { TEMPLATE_PARAM_ALIAS_MAP, TEMPLATE_PARAM_ORDERS } from './fixtures/template_param_orders';

const originalFetch = typeof fetch === 'function' ? fetch.bind(globalThis) : undefined;

/**
 * Resolves the URL string from various RequestInfo types.
 * @param input The RequestInfo or URL to resolve.
 * @returns The URL string, or undefined if it cannot be resolved.
 */
function resolveUrl(input: RequestInfo | URL): string | undefined {
	if (typeof input === 'string') {
		return input;
	}
	if (input instanceof URL) {
		return input.toString();
	}
	if (typeof Request !== 'undefined' && input instanceof Request) {
		return input.url;
	}
	return undefined;
}

/**
 * Extracts the template name from a MediaWiki templatedata action URL.
 * @param targetUrl The target URL string.
 * @returns The template name, or undefined if not found.
 */
function getTemplateName(targetUrl: string): string | undefined {
	try {
		const parsed = new URL(targetUrl, 'https://example.invalid');
		if (parsed.searchParams.get('action') !== 'templatedata') {
			return undefined;
		}
		const titles = parsed.searchParams.get('titles');
		if (!titles) {
			return undefined;
		}
		const normalized = decodeURIComponent(titles).replace(/^Template:/i, '').trim().toLowerCase();
		return normalized || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Builds a mock Response object for the given template name.
 * @param template The template name.
 * @returns A Response object containing the templatedata JSON.
 */
function buildTemplateDataResponse(template: string): Response {
	const order = TEMPLATE_PARAM_ORDERS[template];
	if (!order) {
		throw new Error(`[Cite Forge tests] No fixture for template "${template}"`);
	}
	const aliasConfig = TEMPLATE_PARAM_ALIAS_MAP[template] ?? {};
	const params = order.reduce<Record<string, { aliases: string[] }>>((acc, name) => {
		acc[name] = { aliases: aliasConfig[name]?.slice() ?? [] };
		return acc;
	}, {});
	const payload = {
		batchcomplete: true,
		pages: {
			[template]: {
				title: `Template:${template}`,
				ns: 10,
				paramorder: order,
				params
			}
		}
	};
	return new Response(JSON.stringify(payload), {
		headers: { 'Content-Type': 'application/json' }
	});
}

/**
 * Mocks the global fetch function to intercept templatedata requests.
 */
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
	const targetUrl = resolveUrl(input);
	if (targetUrl) {
		const template = getTemplateName(targetUrl);
		if (template) {
			return buildTemplateDataResponse(template);
		}
	}
	if (!originalFetch) {
		throw new Error('Fetch not available in test environment');
	}
	return originalFetch(input as RequestInfo, init);
}) as typeof fetch;
