let wikitextCache: string | null = null;

/**
 * Get current page wikitext from the edit textbox or API.
 */
export async function getWikitext(): Promise<string> {
	if (wikitextCache !== null) {
		return wikitextCache;
	}

	const textarea = document.getElementById('wpTextbox1') as HTMLTextAreaElement | null;
	if (textarea && textarea.value) {
		wikitextCache = textarea.value;
		return wikitextCache;
	}

	try {
		const api = new mw.Api();
		const title = mw.config.get('wgPageName');
		type QueryResponse = {
			query?: {
				pages?: Array<{
					revisions?: Array<{
						slots?: {
							main?: {
								content?: string | null;
							} | null;
						} | null;
					}> | null;
				}> | null;
			};
		};

		const resp = (await api.get({
			action: 'query',
			prop: 'revisions',
			titles: title,
			rvslots: 'main',
			rvprop: 'content',
			formatversion: 2
		})) as QueryResponse;

		const page = resp.query?.pages?.[0];
		const revision = page?.revisions?.[0];
		const content = revision?.slots?.main?.content ?? '';
		wikitextCache = content || '';
		return wikitextCache;
	} catch (e) {
		console.error('[CiteHub] Failed to fetch wikitext', e);
		wikitextCache = '';
		return wikitextCache;
	}
}

/**
 * Reset cached wikitext (e.g., when page changes or after edit).
 */
export function clearWikitextCache(): void {
	wikitextCache = null;
}
