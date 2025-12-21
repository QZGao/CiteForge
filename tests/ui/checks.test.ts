// @vitest-environment jsdom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enableChecks, disableChecks } from '../../src/ui/checks';

if (!('innerText' in HTMLElement.prototype)) {
	Object.defineProperty(HTMLElement.prototype, 'innerText', {
		configurable: true,
		get() {
			return this.textContent || '';
		},
		set(value: string) {
			this.textContent = value;
		}
	});
}

vi.mock('../../src/i18n', () => ({
	t: (key: string, params?: unknown[]) => {
		if (params && params.length) {
			return `${key}(${params.join('|')})`;
		}
		return key;
	}
}));

function encodeAttr(value: string): string {
	return value.replace(/&/g, '&amp;');
}

function collectText(selector: string): string {
	return Array.from(document.querySelectorAll<HTMLElement>(selector))
		.map((el) => (el.textContent || '').trim())
		.join(' ');
}

function runChecks(html: string): { errors: string; warnings: string } {
	document.body.innerHTML = html;
	enableChecks([]);
	return {
		errors: collectText('.citeforge-check-errors'),
		warnings: collectText('.citeforge-check-warning')
	};
}

describe('ui/checks annotations', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	afterEach(() => {
		disableChecks();
		document.body.innerHTML = '';
	});

	it('detects Harv link issues and orphan citations', () => {
		const baseBook = [
			'ctx_ver=Z39.88-2004',
			'rft.genre=book',
			'rft.place=Paris',
			'rft.pub=PressCo',
			'rft.date=1980'
		].join('&');
		const html = `
			<div>
				<p class="harv hyphen">
					<a href="#CITEREFMissing">Harv error: link to Missing; pp. 10-12</a>
				</p>
				<p class="harv snippet">
					<a href="#CITEREFPresent">Harv error: link to Present; pp. 33</a>
				</p>
				<p class="harv page">
					<a href="#CITEREFPresent">Harv error: link to Present; p. 44-45</a>
				</p>
				<cite id="CITEREFPresent" class="citation book cs1">
					Referenced Book ISBN 12345
					<span class="Z3988" title="${encodeAttr(`${baseBook}&rft_id=http://example.com/present`)}"></span>
				</cite>
				<cite id="CITEREFOrphan" class="citation book cs1">
					Orphan Book ISBN 67890
					<span class="Z3988" title="${encodeAttr(`${baseBook}&rft_id=http://example.com/orphan`)}"></span>
				</cite>
			</div>
		`;

		const { errors, warnings } = runChecks(html);

		expect(errors).toContain('ui.checks.linkHasNoTarget');
		expect(errors).toContain('ui.checks.hyphenInPgRange');
		expect(errors).toContain('ui.checks.ppErrorSnippet');
		expect(warnings).toContain('ui.checks.noLinkPointsToId');
	});

	it('flags formatting quirks, missing chapter pagination, and missing first names', () => {
		const chapterOpenUrl = [
			'ctx_ver=Z39.88-2004',
			'rft.genre=book',
			'rft.atitle=The Missing Chapter',
			'rft.btitle=Collected Essays',
			'rft.au=Smith, John',
			'rft.place=London',
			'rft.pub=Scholarly Press',
			'rft.date=1984',
			'rft_id=http://example.com/chapter'
		].join('&');
		const html = `
			<i class="citation book cs1">
				Chapter without pagination
				<span class="Z3988" title="${encodeAttr(chapterOpenUrl)}"></span>
			</i>
		`;

		const { errors, warnings } = runChecks(html);
		expect(warnings).toContain('ui.checks.unexpectedFormatting');
		expect(warnings).toContain('ui.checks.missingPagenumsChapter');
		expect(errors).toContain('ui.checks.missingFirstName');
	});

	it('enforces book metadata rules', () => {
		const locatedBook = [
			'ctx_ver=Z39.88-2004',
			'rft.genre=book',
			'rft.place=London',
			'rft.pub=PressHouse',
			'rft.date=1988',
			'rft_id=http://example.com/located'
		].join('&');
		const missingPlaceBook = [
			'ctx_ver=Z39.88-2004',
			'rft.genre=book',
			'rft.pub=Nowhere Press',
			'rft.date=1995'
		].join('&');
		const missingPublisher = [
			'ctx_ver=Z39.88-2004',
			'rft.genre=book',
			'rft.place=Lisbon',
			'rft.date=2001',
			'rft_id=http://example.com/missing-publisher'
		].join('&');
		const earlyIsbn = [
			'ctx_ver=Z39.88-2004',
			'rft.genre=book',
			'rft.place=Prague',
			'rft.pub=Archive Press',
			'rft.date=1950',
			'rft.isbn=0000-0000'
		].join('&');
		const missingYear = [
			'ctx_ver=Z39.88-2004',
			'rft.genre=book',
			'rft.place=Paris',
			'rft.pub=Future Press',
			'rft_id=http://example.com/missing-year'
		].join('&');
		const html = `
			<div>
				<cite class="citation book cs1">
					Located Reference ISBN 000
					<span class="Z3988" title="${encodeAttr(locatedBook)}"></span>
				</cite>
				<cite class="citation book cs1">
					Location Missing Volume
					<span class="Z3988" title="${encodeAttr(missingPlaceBook)}"></span>
				</cite>
				<cite class="citation book cs1">
					Publisher Missing Volume
					<span class="Z3988" title="${encodeAttr(missingPublisher)}"></span>
				</cite>
				<cite class="citation book cs1">
					Early Reference Volume
					<span class="Z3988" title="${encodeAttr(earlyIsbn)}"></span>
				</cite>
				<cite class="citation book cs1">
					Yearless Volume
					<span class="Z3988" title="${encodeAttr(missingYear)}"></span>
				</cite>
			</div>
		`;

		const { errors } = runChecks(html);

		expect(errors).toContain('ui.checks.inconsistentPublisherLocation');
		expect(errors).toContain('ui.checks.missingIdentifier');
		expect(errors).toContain('ui.checks.missingPublisher');
		expect(errors).toContain('ui.checks.pubTooEarlyForIsbn');
		expect(errors).toContain('ui.checks.missingControlNumber');
		expect(errors).toContain('ui.checks.missingYearDate');
	});

	it('handles identifier rules, cite news exemption, and web archive requirements', () => {
		const journalArticle = [
			'ctx_ver=Z39.88-2004',
			'rft.genre=article',
			'rft.jtitle=Journal of Tests',
			'rft.date=2021'
		].join('&');
		const newsArticle = [
			'ctx_ver=Z39.88-2004',
			'rft.genre=article',
			'rft.jtitle=Daily Planet',
			'rft.date=2022'
		].join('&');
		const webCitation = ['ctx_ver=Z39.88-2004', 'rft_id=http://example.com/page'].join('&');
		const html = `
			<div>
				<cite class="citation journal cs1">
					Journal entry
					<span class="Z3988" title="${encodeAttr(journalArticle)}"></span>
				</cite>
				<cite class="citation news cs1">
					News entry
					<span class="Z3988" title="${encodeAttr(newsArticle)}"></span>
				</cite>
				<cite class="citation web cs1">
					Web entry
					<span class="Z3988" title="${encodeAttr(webCitation)}"></span>
				</cite>
			</div>
		`;

		const { errors } = runChecks(html);
		expect(errors).toContain('ui.checks.missingIdentifier');
		expect(errors).toContain('ui.checks.missingArchiveLink');
		expect(errors).toContain('ui.checks.missingAccessDate');

		const newsNode = document.querySelector<HTMLElement>('cite.citation.news');
		expect(newsNode).not.toBeNull();
		expect(newsNode?.querySelectorAll('.citeforge-check-errors').length).toBe(0);
	});

	it('reports reference sorting mistakes', () => {
		const html = `
			<ul id="toc">
				<li><span class="toctext">References</span></li>
			</ul>
			<h2><span class="mw-headline" id="References">References</span></h2>
			<div>
				<cite class="citation cs1">Alpha Example 2000.</cite>
				<cite class="citation cs1">Alpha Example 2000.</cite>
				<cite id="CITEREFCharlie2005" class="citation cs1">Charlie, Charles (2005).</cite>
				<cite id="CITEREFBravo2003" class="citation cs1">Bravo, Bob (2003).</cite>
			</div>
		`;

		const { warnings } = runChecks(html);
		expect(warnings).toContain('ui.checks.missingRefAnchor');
		expect(warnings).toContain('ui.checks.duplicateAuthorDate');
		expect(warnings).toContain('ui.checks.sortErrorExpected');
	});
});
