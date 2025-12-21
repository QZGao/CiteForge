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

type CheckCase = {
	name: string;
	html: string;
	expectErrors?: string[];
	expectWarnings?: string[];
	forbidErrors?: string[];
	forbidWarnings?: string[];
};

const BOOK_BASE = ['ctx_ver=Z39.88-2004', 'rft.genre=book'];
const ARTICLE_BASE = ['ctx_ver=Z39.88-2004', 'rft.genre=article'];
const WEB_BASE = ['ctx_ver=Z39.88-2004'];

function encodeAttr(value: string): string {
	return value.replace(/&/g, '&amp;');
}

function bookMeta(extra: string[]): string {
	return encodeAttr([...BOOK_BASE, ...extra].join('&'));
}

function articleMeta(extra: string[]): string {
	return encodeAttr([...ARTICLE_BASE, ...extra].join('&'));
}

function webMeta(extra: string[]): string {
	return encodeAttr([...WEB_BASE, ...extra].join('&'));
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

function referenceSection(inner: string): string {
	return `
		<ul id="toc">
			<li><span class="toctext">References</span></li>
		</ul>
		<h2><span class="mw-headline" id="References">References</span></h2>
		<div>${inner}</div>
	`;
}

const CASES: CheckCase[] = [
	{
		name: 'flags P/PP mismatch when Harv snippets lack range indicators',
		html: `
			<div>
				<p><a href="#CITEREFPp">Harv error: link to CITEREFPp; pp. 33</a></p>
				<cite id="CITEREFPp" class="citation book cs1">
					Example Source
					<span class="Z3988" title="${bookMeta([
						'rft.place=Paris',
						'rft.pub=PressHouse',
						'rft.date=1985',
						'rft_id=http://example.com/pp'
					])}"></span>
				</cite>
			</div>
		`,
		expectErrors: ['ui.checks.ppErrorSnippet']
	},
	{
		name: 'notes hyphen usage inside page ranges',
		html: `
			<div>
				<p><a href="#CITEREFHyphen">Harv error: link to CITEREFHyphen; pp. 10-12</a></p>
				<cite id="CITEREFHyphen" class="citation book cs1">
					Example Range
					<span class="Z3988" title="${bookMeta([
						'rft.place=Paris',
						'rft.pub=PressHouse',
						'rft.date=1985',
						'rft_id=http://example.com/hyphen'
					])}"></span>
				</cite>
			</div>
		`,
		expectErrors: ['ui.checks.hyphenInPgRange']
	},
	{
		name: 'reports Harv backlinks with missing targets',
		html: `<p><a href="#CITEREFMissing">Harv error: link to CITEREFMissing; p. 5</a></p>`,
		expectErrors: ['ui.checks.linkHasNoTarget']
	},
	{
		name: 'warns when CITEREF ids lack inbound links',
		html: `
			<div>
				<p><a href="#CITEREFLinked">Harv error: link to CITEREFLinked</a></p>
				<cite id="CITEREFLinked" class="citation book cs1">
					Linked reference
					<span class="Z3988" title="${bookMeta([
						'rft.place=Paris',
						'rft.pub=PressHouse',
						'rft.date=1984',
						'rft_id=http://example.com/linked'
					])}"></span>
				</cite>
				<cite id="CITEREFOrphan" class="citation book cs1">
					Orphan reference
					<span class="Z3988" title="${bookMeta([
						'rft.place=Paris',
						'rft.pub=PressHouse',
						'rft.date=1984',
						'rft_id=http://example.com/orphan'
					])}"></span>
				</cite>
			</div>
		`,
		expectWarnings: ['ui.checks.noLinkPointsToId']
	},
	{
		name: 'warns about citations wrapped by italics or bold tags',
		html: `
			<i class="citation book cs1">
				Italic citation
				<span class="Z3988" title="${bookMeta([
					'rft.place=Paris',
					'rft.pub=PressHouse',
					'rft.date=1984',
					'rft_id=http://example.com/formatting'
				])}"></span>
			</i>
		`,
		expectWarnings: ['ui.checks.unexpectedFormatting']
	},
	{
		name: 'flags missing page numbers for book chapters',
		html: `
			<cite class="citation book cs1">
				Chapter citation
				<span class="Z3988" title="${bookMeta([
					'rft.atitle=Chapter+One',
					'rft.btitle=Collected+Stories',
					'rft.place=Paris',
					'rft.pub=PressHouse',
					'rft.date=1984',
					'rft_id=http://example.com/chapter'
				])}"></span>
			</cite>
		`,
		expectWarnings: ['ui.checks.missingPagenumsChapter']
	},
	{
		name: 'requires first names for authors in metadata',
		html: `
			<cite class="citation book cs1">
				Asimov citation
				<span class="Z3988" title="${bookMeta([
					'rft.au=Asimov',
					'rft.place=Paris',
					'rft.pub=PressHouse',
					'rft.date=1984',
					'rft_id=http://example.com/asimov'
				])}"></span>
			</cite>
		`,
		expectErrors: ['ui.checks.missingFirstName']
	},
	{
		name: 'ignores missing first names when citation text includes et al.',
		html: `
			<cite class="citation book cs1">
				Example et al.
				<span class="Z3988" title="${bookMeta([
					'rft.au=Smith',
					'rft.place=Paris',
					'rft.pub=PressHouse',
					'rft.date=1984',
					'rft_id=http://example.com/etal'
				])}"></span>
			</cite>
		`,
		forbidErrors: ['ui.checks.missingFirstName']
	},
	{
		name: 'skips missing first names for CJK authors',
		html: `
			<cite class="citation book cs1">
				CJK citation
				<span class="Z3988" title="${bookMeta([
					'rft.au=李',
					'rft.place=Hong+Kong',
					'rft.pub=PressHouse',
					'rft.date=1984',
					'rft_id=http://example.com/cjk'
				])}"></span>
			</cite>
		`,
		forbidErrors: ['ui.checks.missingFirstName']
	},
	{
		name: 'requires identifiers for journal-style citations',
		html: `
			<cite class="citation journal cs1">
				Journal entry
				<span class="Z3988" title="${articleMeta([
					'rft.jtitle=Journal+of+Tests',
					'rft.date=2020'
				])}"></span>
			</cite>
		`,
		expectErrors: ['ui.checks.missingIdentifier']
	},
	{
		name: 'allows cite news template to omit identifiers',
		html: `
			<cite class="citation news cs1">
				News entry
				<span class="Z3988" title="${articleMeta([
					'rft.jtitle=Daily+Planet',
					'rft.date=2022'
				])}"></span>
			</cite>
		`,
		forbidErrors: ['ui.checks.missingIdentifier']
	},
	{
		name: 'tracks inconsistent use of publisher location data',
		html: `
			<div>
				<cite class="citation book cs1">
					Has location
					<span class="Z3988" title="${bookMeta([
						'rft.place=Paris',
						'rft.pub=PressHouse',
						'rft.date=1984',
						'rft_id=http://example.com/location-a'
					])}"></span>
				</cite>
				<cite class="citation book cs1">
					Missing location
					<span class="Z3988" title="${bookMeta([
						'rft.pub=PressHouse',
						'rft.date=1985',
						'rft_id=http://example.com/location-b'
					])}"></span>
				</cite>
			</div>
		`,
		expectErrors: ['ui.checks.inconsistentPublisherLocation']
	},
	{
		name: 'one of the exempt university presses can omit location without warnings',
		html: `
			<div>
				<cite class="citation book cs1">
					Standard Press entry
					<span class="Z3988" title="${bookMeta([
						'rft.place=Paris',
						'rft.pub=PressHouse',
						'rft.date=1980',
						'rft_id=http://example.com/location-normal'
					])}"></span>
				</cite>
				<cite class="citation book cs1">
					Oxford University Press edition
					<span class="Z3988" title="${bookMeta([
						'rft.pub=Oxford+University+Press',
						'rft.date=1981',
						'rft_id=http://example.com/location-oxford'
					])}"></span>
				</cite>
			</div>
		`,
		forbidErrors: ['ui.checks.inconsistentPublisherLocation']
	},
	{
		name: 'warns when book citations lack publisher data',
		html: `
			<cite class="citation book cs1">
				Publisher missing
				<span class="Z3988" title="${bookMeta([
					'rft.place=Paris',
					'rft.date=1984',
					'rft_id=http://example.com/nopublisher'
				])}"></span>
			</cite>
		`,
		expectErrors: ['ui.checks.missingPublisher']
	},
	{
		name: 'treats book chapters (bookitem) with btitle as having an implicit publisher',
		html: `
			<cite class="citation book cs1">
				Book chapter citation
				<span class="Z3988" title="${bookMeta([
					'rft.genre=bookitem',
					'rft.btitle=Collected+Stories',
					'rft.place=Paris',
					'rft.date=1984',
					'rft_id=http://example.com/bookitem'
				])}"></span>
			</cite>
		`,
		forbidErrors: ['ui.checks.missingPublisher']
	},
	{
		name: 'requires identifiers (ISBN/OCLC) for modern books',
		html: `
			<cite class="citation book cs1">
				Modern book without identifiers
				<span class="Z3988" title="${bookMeta([
					'rft.place=Paris',
					'rft.pub=PressHouse',
					'rft.date=1995'
				])}"></span>
			</cite>
		`,
		expectErrors: ['ui.checks.missingIdentifier']
	},
	{
		name: 'detects ISBN usage on pre-1970 publications',
		html: `
			<cite class="citation book cs1">
				Early ISBN citation
				<span class="Z3988" title="${bookMeta([
					'rft.place=Paris',
					'rft.pub=PressHouse',
					'rft.date=1950',
					'rft.isbn=1234567890',
					'rft_id=http://example.com/earlyisbn'
				])}"></span>
			</cite>
		`,
		expectErrors: ['ui.checks.pubTooEarlyForIsbn']
	},
	{
		name: 'does not flag pre-1970 ISBN if citation text indicates a reprint',
		html: `
			<cite class="citation book cs1">
				Reprint edition (1950) [1990]
				<span class="Z3988" title="${bookMeta([
					'rft.place=Paris',
					'rft.pub=PressHouse',
					'rft.date=1950',
					'rft.isbn=1234567890',
					'rft_id=http://example.com/reprint'
				])}"></span>
			</cite>
		`,
		forbidErrors: ['ui.checks.pubTooEarlyForIsbn']
	},
	{
		name: 'requires control numbers (e.g., OCLC) for older books',
		html: `
			<cite class="citation book cs1">
				Pre-1970 citation
				<span class="Z3988" title="${bookMeta([
					'rft.place=Paris',
					'rft.pub=PressHouse',
					'rft.date=1955'
				])}"></span>
			</cite>
		`,
		expectErrors: ['ui.checks.missingControlNumber']
	},
	{
		name: 'requires year or date metadata for book citations',
		html: `
			<cite class="citation book cs1">
				No year provided
				<span class="Z3988" title="${bookMeta([
					'rft.place=Paris',
					'rft.pub=PressHouse',
					'rft_id=http://example.com/nodate'
				])}"></span>
			</cite>
		`,
		expectErrors: ['ui.checks.missingYearDate']
	},
	{
		name: 'adds missing archive and access date warnings for web sources',
		html: `
			<cite class="citation web cs1">
				Web citation
				<span class="Z3988" title="${webMeta(['rft_id=http://example.com/web'])}"></span>
			</cite>
		`,
		expectErrors: ['ui.checks.missingArchiveLink', 'ui.checks.missingAccessDate']
	},
	{
		name: 'respects archive indicators already present in citation text',
		html: `
			<cite class="citation web cs1">
				Archived from the original
				<span class="Z3988" title="${webMeta(['rft_id=http://example.com/archived'])}"></span>
			</cite>
		`,
		forbidErrors: ['ui.checks.missingArchiveLink', 'ui.checks.missingAccessDate']
	},
	{
		name: 'accepts metadata dates as access dates when archive is missing',
		html: `
			<cite class="citation web cs1">
				Web entry
				<span class="Z3988" title="${webMeta([
					'rft_id=http://example.com/webdate',
					'rft.date=2024-01-01'
				])}"></span>
			</cite>
		`,
		expectErrors: ['ui.checks.missingArchiveLink'],
		forbidErrors: ['ui.checks.missingAccessDate']
	},
	{
		name: 'warns when citations lack ref anchors',
		html: referenceSection(`
			<cite class="citation cs1">Anchorless source</cite>
		`),
		expectWarnings: ['ui.checks.missingRefAnchor']
	},
	{
		name: 'spotlights duplicate author/date combinations',
		html: referenceSection(`
			<cite id="CITEREFAlpha2000" class="citation cs1">Alpha Example 2000.</cite>
			<cite id="CITEREFAlpha2000" class="citation cs1">Alpha Example 2000.</cite>
		`),
		expectWarnings: ['ui.checks.duplicateAuthorDate']
	},
	{
		name: 'detects out-of-order references inside reference sections',
		html: referenceSection(`
			<cite id="CITEREFCharlie1990" class="citation cs1">Charlie, Charles (1990).</cite>
			<cite id="CITEREFBravo1980" class="citation cs1">Bravo, Bob (1980).</cite>
		`),
		expectWarnings: ['ui.checks.sortErrorExpected']
	}
];

describe('ui/checks descriptive table coverage', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	afterEach(() => {
		disableChecks();
		document.body.innerHTML = '';
	});

	CASES.forEach(({ name, html, expectErrors, expectWarnings, forbidErrors, forbidWarnings }) => {
		it(name, () => {
			const { errors, warnings } = runChecks(html);
			(expectErrors || []).forEach((msg) => {
				expect(errors).toContain(msg);
			});
			(expectWarnings || []).forEach((msg) => {
				expect(warnings).toContain(msg);
			});
			(forbidErrors || []).forEach((msg) => {
				expect(errors).not.toContain(msg);
			});
			(forbidWarnings || []).forEach((msg) => {
				expect(warnings).not.toContain(msg);
			});
		});
	});
});
