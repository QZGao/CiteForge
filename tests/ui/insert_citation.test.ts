// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
	applyUnmappedCitoidParams,
	applyCitoidMappedParams,
	buildCitationWikitext,
	captureInsertionTarget,
	createAuthorRow,
	createDefaultRowsForTemplate,
	createParamRow,
	findAutoFillQuery,
	insertTextAtSelection,
	mapCitoidDataToParams,
	toggleAuthorRowMode
} from '../../src/ui/insert_citation';

describe('insert citation helpers', () => {
	it('renders filled params in row order', () => {
		const authorRow = createAuthorRow('split');
		authorRow.split.last.value = 'Doe';
		authorRow.split.first.value = 'Jane';
		authorRow.split.link.value = 'Jane_Doe';

		const text = buildCitationWikitext('cite web', '', [
			createParamRow('url', 'https://example.org'),
			createParamRow('title', 'Example source'),
			authorRow,
			createParamRow('access-date', '2026-03-15'),
			createParamRow('archive-url', '')
		]);

		expect(text).toBe(
			'<ref>{{cite web' +
			'|url=https://example.org' +
			'|title=Example source' +
			'|last1=Doe' +
			'|first1=Jane' +
			'|author-link1=Jane_Doe' +
			'|access-date=2026-03-15' +
			'}}</ref>'
		);
	});

	it('renders a named ref when a ref name is provided', () => {
		const text = buildCitationWikitext('cite web', 'example-ref', [
			createParamRow('url', 'https://example.org')
		]);

		expect(text).toBe('<ref name="example-ref">{{cite web|url=https://example.org}}</ref>');
	});

	it('escapes ref name attribute values', () => {
		const text = buildCitationWikitext('cite web', 'quote " amp &', []);

		expect(text).toBe('<ref name="quote &quot; amp &amp;">{{cite web}}</ref>');
	});

	it('toggles between split and single author modes', () => {
		const row = createAuthorRow('split');
		row.split.first.value = 'Jane';
		row.split.last.value = 'Doe';
		row.split.link.value = 'Jane_Doe';

		toggleAuthorRowMode(row, true);
		expect(row.mode).toBe('single');
		expect(row.single.author.value).toBe('Jane Doe');
		expect(row.single.link.value).toBe('Jane_Doe');

		row.single.author.value = 'Doe, Jane';
		toggleAuthorRowMode(row, false);
		expect(row.mode).toBe('split');
		expect(row.split.last.value).toBe('Doe');
		expect(row.split.first.value).toBe('Jane');
		expect(row.split.link.value).toBe('Jane_Doe');
	});

	it('uses increasing indices for additional author rows', () => {
		const row = createAuthorRow('split', 2);

		expect(row.index).toBe(2);
		expect(row.split.last.name).toBe('last2');
		expect(row.split.first.name).toBe('first2');
		expect(row.split.link.name).toBe('author-link2');
		expect(row.single.author.name).toBe('author2');
		expect(row.single.link.name).toBe('author-link2');
	});

	it('prefills access-date with today on dialog startup rows', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-03-15T10:30:00'));

		try {
			const rows = createDefaultRowsForTemplate('cite web');
			const accessDateRow = rows.find(
				(row) => row.kind === 'param' && row.field.name === 'access-date'
			);

			expect(accessDateRow).toMatchObject({
				kind: 'param',
				field: {
					name: 'access-date',
					value: '2026-03-15'
				}
			});
		} finally {
			vi.useRealTimers();
		}
	});

	it('prefers the first supported source field for auto-fill queries', () => {
		const query = findAutoFillQuery('cite web', [
			createParamRow('title', 'Example'),
			createParamRow('doi', '10.1000/example'),
			createParamRow('url', 'https://example.org')
		]);

		expect(query).toEqual({
			query: 'https://example.org',
			sourceParam: 'url'
		});
	});

	it('maps citoid payloads into template parameters', () => {
		const mapped = mapCitoidDataToParams(
			{
				title: 'Measured measurement',
				url: 'https://www.nature.com/articles/nphys1170',
				publicationTitle: 'Nature Physics',
				date: '2009-01',
				DOI: '10.1038/nphys1170',
				author: [
					['Markus', 'Aspelmeyer'],
					['Jane', 'Doe']
				],
				accessDate: '2026-03-16'
			},
			{
				title: 'title',
				url: 'url',
				publicationTitle: 'journal',
				date: 'date',
				DOI: 'doi',
				accessDate: 'access-date',
				author: [
					['first', 'last'],
					['first2', 'last2']
				]
			}
		);

		expect(mapped).toEqual({
			title: 'Measured measurement',
			url: 'https://www.nature.com/articles/nphys1170',
			journal: 'Nature Physics',
			date: '2009-01',
			doi: '10.1038/nphys1170',
			'access-date': '2026-03-16',
			first: 'Markus',
			last: 'Aspelmeyer',
			first2: 'Jane',
			last2: 'Doe'
		});
	});

	it('fills unmapped citoid fields from other TemplateData citoid maps when the current template supports the target param', () => {
		const mapped = applyUnmappedCitoidParams(
			'cite journal',
			{
				title: 'Genshin Impact Fan Creates Arlecchino and Columbina Character Portraits',
				date: '2023-03-29',
				url: 'https://gamerant.com/genshin-impact-fan-arlecchino-columbina-character-portraits/',
				language: 'en',
				accessDate: '2026-03-16',
				websiteTitle: 'GameRant',
				author: [['Hajrudin', 'Krdzic']]
			},
			{
				title: 'Genshin Impact Fan Creates Arlecchino and Columbina Character Portraits',
				date: '2023-03-29',
				first: 'Hajrudin',
				last: 'Krdzic'
			},
			{
				title: 'title',
				date: 'date',
				author: [['first', 'last']]
			},
			[
				{
					websiteTitle: 'website'
				}
			],
			['title', 'date', 'url', 'language', 'access-date', 'website', 'journal', 'first', 'last']
		);

		expect(mapped).toEqual({
			title: 'Genshin Impact Fan Creates Arlecchino and Columbina Character Portraits',
			date: '2023-03-29',
			first: 'Hajrudin',
			last: 'Krdzic',
			url: 'https://gamerant.com/genshin-impact-fan-arlecchino-columbina-character-portraits/',
			language: 'en',
			'access-date': '2026-03-16',
			website: 'GameRant'
		});
	});

	it('applies mapped citoid params to split author and parameter rows', () => {
		const rows = [
			createAuthorRow('split', 1),
			createParamRow('url', 'https://example.org'),
			createParamRow('title', '')
		];

		const updated = applyCitoidMappedParams('cite web', rows, {
			first: 'Markus',
			last: 'Aspelmeyer',
			title: 'Measured measurement',
			website: 'Nature',
			first2: 'Jane',
			last2: 'Doe'
		});

		expect(updated[0]).toMatchObject({
			kind: 'author',
			index: 1,
			split: {
				first: { value: 'Markus' },
				last: { value: 'Aspelmeyer' }
			}
		});
		expect(updated[1]).toMatchObject({
			kind: 'author',
			index: 2,
			split: {
				first: { value: 'Jane' },
				last: { value: 'Doe' }
			}
		});
		expect(updated).toContainEqual(
			expect.objectContaining({
				kind: 'param',
				field: expect.objectContaining({
					name: 'title',
					value: 'Measured measurement'
				})
			})
		);
		expect(updated).toContainEqual(
			expect.objectContaining({
				kind: 'param',
				field: expect.objectContaining({
					name: 'website',
					value: 'Nature'
				})
			})
		);
	});

	it('applies split citoid author data to single author rows', () => {
		const row = createAuthorRow('single', 1);
		row.single.link.value = 'Existing';

		const [updatedRow] = applyCitoidMappedParams('cite web', [row], {
			first: 'Jane',
			last: 'Doe',
			'author-link': 'Jane_Doe'
		});

		expect(updatedRow).toMatchObject({
			kind: 'author',
			mode: 'single',
			single: {
				author: { value: 'Jane Doe' },
				link: { value: 'Jane_Doe' }
			}
		});
	});

	it('inserts rendered text at the captured cursor position', () => {
		const textarea = document.createElement('textarea');
		textarea.value = 'Before After';
		textarea.selectionStart = 7;
		textarea.selectionEnd = 7;
		const snippet = '<ref>{{cite web}}</ref>';

		const target = captureInsertionTarget(textarea);
		insertTextAtSelection(textarea, snippet, target);

		expect(textarea.value).toBe(`Before ${snippet}After`);
		expect(textarea.selectionStart).toBe(`Before ${snippet}`.length);
		expect(textarea.selectionEnd).toBe(`Before ${snippet}`.length);
	});

	it('prefers textSelection replaceSelection when available', () => {
		const textarea = document.createElement('textarea');
		const textSelection = vi.fn();
		const originalDollar = (globalThis as { $?: unknown }).$;
		(globalThis as { $?: (value: HTMLTextAreaElement) => { textSelection: typeof textSelection } }).$ = vi.fn(() => ({
			textSelection
		}));

		try {
			insertTextAtSelection(textarea, '<ref>{{cite web}}</ref>');

			expect(textSelection).toHaveBeenCalledWith('replaceSelection', '<ref>{{cite web}}</ref>');
			expect(textarea.value).toBe('');
		} finally {
			(globalThis as { $?: unknown }).$ = originalDollar;
		}
	});
});
