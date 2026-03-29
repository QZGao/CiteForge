// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('TemplateData citoid map fetch', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		vi.resetModules();
		localStorage.clear();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		localStorage.clear();
	});

	it('fetches the citoid map from English Wikipedia even when local param order is already cached', async () => {
		localStorage.setItem(
			'citeforge-template-param-order',
			JSON.stringify({
				'cite web': {
					order: ['url', 'title'],
					aliases: {}
				}
			})
		);

		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				pages: {
					'cite web': {
						title: 'Template:Cite web',
						maps: {
							citoid: {
								title: 'title',
								url: 'url'
							}
						}
					}
				}
			})
		});
		globalThis.fetch = fetchMock as typeof fetch;

		const { fetchTemplateDataCitoidMap } = await import('../../src/data/templatedata_fetch');
		const citoidMap = await fetchTemplateDataCitoidMap('cite web');

		expect(fetchMock).toHaveBeenCalledWith(
			'https://en.wikipedia.org/w/api.php?action=templatedata&titles=Template%3ACite%20web&redirects=true&formatversion=2&format=json&origin=*'
		);
		expect(citoidMap).toEqual({
			title: 'title',
			url: 'url'
		});
	});

	it('normalizes underscore and hyphen variants in fetched TemplateData keys', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			json: async () => ({
				pages: {
					'cite video game': {
						title: 'Template:Cite video game',
						paramorder: ['title', 'trans_title', 'script-title'],
						params: {
							title: { aliases: [] },
							trans_title: { aliases: ['trans-title'] },
							'script-title': { aliases: [] }
						}
					}
				}
			})
		});
		globalThis.fetch = fetchMock as typeof fetch;

		const { fetchTemplateDataOrder, getTemplateAliasMap } = await import('../../src/data/templatedata_fetch');
		const order = await fetchTemplateDataOrder('cite video game');

		expect(order).toEqual(['title', 'trans-title', 'script-title']);
		expect(getTemplateAliasMap('cite video game')).toEqual({
			'trans-title': 'trans-title'
		});
	});
});
