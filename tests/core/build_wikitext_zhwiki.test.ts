// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('transformWikitext with zhwiki-style TemplateData', () => {
	beforeEach(() => {
		vi.resetModules();
		localStorage.clear();
	});

	it('treats underscore-form TemplateData order keys as the same param during normalization', async () => {
		localStorage.setItem(
			'citeforge-template-param-order',
			JSON.stringify({
				'cite video game': {
					order: ['title', 'trans_title', 'script-title'],
					aliases: {}
				}
			})
		);

		const { transformWikitext } = await import('../../src/core/build_wikitext');
		const result = transformWikitext(
			'<ref>{{cite video game|script-title=ja:Foo|trans-title=Foo|title=Bar}}</ref>',
			{ normalizeAll: true }
		);

		const titlePos = result.wikitext.indexOf('|title=Bar');
		const transTitlePos = result.wikitext.indexOf('|trans-title=Foo');
		const scriptTitlePos = result.wikitext.indexOf('|script-title=ja:Foo');

		expect(titlePos).toBeGreaterThan(-1);
		expect(transTitlePos).toBeGreaterThan(titlePos);
		expect(scriptTitlePos).toBeGreaterThan(transTitlePos);
	});

	it('normalizes cite template names that use underscores instead of spaces', async () => {
		localStorage.setItem(
			'citeforge-template-param-order',
			JSON.stringify({
				'cite web': {
					order: ['title', 'url', 'last', 'access-date'],
					aliases: {}
				}
			})
		);

		const { transformWikitext } = await import('../../src/core/build_wikitext');
		const result = transformWikitext(
			'<ref>{{cite_web|last=Smith|access-date=2021年5月2日|title=Bar|url=https://example.com}}</ref>',
			{ normalizeAll: true }
		);

		expect(result.wikitext).toContain('{{cite_web |title=Bar |url=https://example.com |last=Smith |access-date=2021-05-02}}');
	});
});
