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
});
