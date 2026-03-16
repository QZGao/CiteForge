// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { fetchCitoidData } from '../../src/data/citoid';

describe('citoid data client', () => {
	it('uses the configured RESTBase endpoint and returns the first result item', async () => {
		const originalFetch = globalThis.fetch;
		const originalMw = (globalThis as { mw?: unknown }).mw;
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [{ title: 'Example Domain' }]
		});

		globalThis.fetch = fetchMock as typeof fetch;
		(globalThis as { mw?: { config: { get: (key: string) => unknown } } }).mw = {
			config: {
				get: (key: string): unknown => {
					if (key === 'wgCitoidConfig') {
						return {
							fullRestbaseUrl: 'https://example.org/api/rest_'
						};
					}
					return undefined;
				}
			}
		};

		try {
			const result = await fetchCitoidData('https://example.com');

			expect(fetchMock).toHaveBeenCalledWith(
				'https://example.org/api/rest_v1/data/citation/mediawiki/https%3A%2F%2Fexample.com',
				{
					headers: {
						accept: 'application/json'
					}
				}
			);
			expect(result).toEqual({
				title: 'Example Domain'
			});
		} finally {
			globalThis.fetch = originalFetch;
			(globalThis as { mw?: unknown }).mw = originalMw;
		}
	});

	it('does not append a second v1 segment when the base already ends with rest_v1', async () => {
		const originalFetch = globalThis.fetch;
		const originalMw = (globalThis as { mw?: unknown }).mw;
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [{ title: 'Example Domain' }]
		});

		globalThis.fetch = fetchMock as typeof fetch;
		(globalThis as { mw?: { config: { get: (key: string) => unknown } } }).mw = {
			config: {
				get: (key: string): unknown => {
					if (key === 'wgCitoidConfig') {
						return {
							fullRestbaseUrl: 'https://example.org/api/rest_v1/'
						};
					}
					return undefined;
				}
			}
		};

		try {
			await fetchCitoidData('https://example.com');

			expect(fetchMock).toHaveBeenCalledWith(
				'https://example.org/api/rest_v1/data/citation/mediawiki/https%3A%2F%2Fexample.com',
				{
					headers: {
						accept: 'application/json'
					}
				}
			);
		} finally {
			globalThis.fetch = originalFetch;
			(globalThis as { mw?: unknown }).mw = originalMw;
		}
	});

	it('uses a configured citoid service URL as a REST-style endpoint', async () => {
		const originalFetch = globalThis.fetch;
		const originalMw = (globalThis as { mw?: unknown }).mw;
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => [{ title: 'Kotaku article' }]
		});

		globalThis.fetch = fetchMock as typeof fetch;
		(globalThis as { mw?: { config: { get: (key: string) => unknown } } }).mw = {
			config: {
				get: (key: string): unknown => {
					if (key === 'wgCitoidConfig') {
						return {
							citoidServiceUrl: '/api/rest_v1/data/citation'
						};
					}
					return undefined;
				}
			}
		};

		try {
			const result = await fetchCitoidData('https://example.com/article');

			expect(fetchMock).toHaveBeenCalledWith(
				'/api/rest_v1/data/citation/mediawiki/https%3A%2F%2Fexample.com%2Farticle',
				{
					headers: {
						accept: 'application/json'
					}
				}
			);
			expect(result).toEqual({
				title: 'Kotaku article'
			});
		} finally {
			globalThis.fetch = originalFetch;
			(globalThis as { mw?: unknown }).mw = originalMw;
		}
	});

	it('accepts payloads wrapped in an items array', async () => {
		const originalFetch = globalThis.fetch;
		const originalMw = (globalThis as { mw?: unknown }).mw;
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({
				items: [{ title: 'Wrapped citation' }]
			})
		});

		globalThis.fetch = fetchMock as typeof fetch;
		(globalThis as { mw?: { config: { get: () => undefined } } }).mw = {
			config: {
				get: () => undefined
			}
		};

		try {
			const result = await fetchCitoidData('https://example.com');
			expect(result).toEqual({
				title: 'Wrapped citation'
			});
		} finally {
			globalThis.fetch = originalFetch;
			(globalThis as { mw?: unknown }).mw = originalMw;
		}
	});

	it('includes request diagnostics when the response is not ok', async () => {
		const originalFetch = globalThis.fetch;
		const originalMw = (globalThis as { mw?: unknown }).mw;
		const fetchMock = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			statusText: 'Not Found',
			text: async () => 'missing'
		});

		globalThis.fetch = fetchMock as typeof fetch;
		(globalThis as { mw?: { config: { get: (key: string) => unknown } } }).mw = {
			config: {
				get: (key: string): unknown => {
					if (key === 'wgCitoidConfig') {
						return {
							fullRestbaseUrl: 'https://example.org/api/rest_v1/'
						};
					}
					return undefined;
				}
			}
		};

		try {
			await expect(fetchCitoidData('https://example.com')).rejects.toMatchObject({
				message: 'Citoid request failed with status 404',
				requestUrl: 'https://example.org/api/rest_v1/data/citation/mediawiki/https%3A%2F%2Fexample.com',
				requestSource: 'restbase',
				status: 404,
				statusText: 'Not Found',
				responseText: 'missing'
			});
		} finally {
			globalThis.fetch = originalFetch;
			(globalThis as { mw?: unknown }).mw = originalMw;
		}
	});
});
