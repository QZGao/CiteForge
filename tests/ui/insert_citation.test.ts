// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import {
	buildCitationWikitext,
	captureInsertionTarget,
	createAuthorRow,
	createParamRow,
	insertTextAtSelection,
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
