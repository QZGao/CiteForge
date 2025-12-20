import { describe, expect, it } from 'vitest';
import {
	DEFAULT_CONFIG,
	IncrementStyle,
	NAMING_FIELDS,
	type NamingField,
	buildSuggestion,
	createDefaultConfig,
	extractMetadata,
	normalizeFieldSelection
} from '../../src/core/mass_rename';
import { Reference } from '../../src/types';

const baseRef = (overrides: Partial<Reference> = {}): Reference => ({
	id: 'id1',
	name: 'ref1',
	group: null,
	contentWikitext: '',
	uses: [],
	...overrides
});

describe('mass_rename core helpers', () => {
	it('normalizes field selection by removing duplicates and invalid entries', () => {
		const selection: NamingField[] = ['title', 'title', 'work', 'invalid' as NamingField, 'year'];
		const normalized = normalizeFieldSelection(selection, NAMING_FIELDS);
		expect(normalized).toEqual(['title', 'work', 'year']);
	});

	it('extracts metadata including language-stripped script-title and domains', () => {
		const ref = baseRef({
			contentWikitext:
				'{{cite web|script-title=ja:やわらぎ|url=https://sub.example.co.uk/path|date=2023-07-05|author=Foo Bar|publisher=Pub}}'
		});
		const meta = extractMetadata(ref);
		expect(meta.title).toBe('やわらぎ');
		expect(meta.domain).toBe('sub.example.co.uk');
		expect(meta.domainShort).toBe('example');
		expect(meta.publisher).toBe('Pub');
		expect(meta.dateYMD).toBe('20230705');
		expect(meta.year).toBe('2023');
		expect(meta.dateDisplay).toMatch(/2023/);
	});

	it('extracts partial dates and falls back to text years in content', () => {
		const ref = baseRef({
			contentWikitext: '{{cite news|title=Foo|date=2020-02|url=https://example.com}} Published 1999'
		});
		const meta = extractMetadata(ref);
		expect(meta.dateYMD).toBe('20200201');
		expect(meta.year).toBe('2020');
		// Because a primary year is present, textYear fallback is not populated
		expect(meta.textYear).toBeUndefined();
	});

	it('builds suggestions with default fields (domainShort + fulldate)', () => {
		const ref = baseRef({ name: null });
		const reserved = new Set<string>();
		const meta = {
			domainShort: 'example',
			dateYMD: '20230705'
		};
		const suggestion = buildSuggestion(meta, ref, createDefaultConfig(), reserved);
		expect(suggestion).toBe('example-20230705');
	});

	it('applies delimiterConditional only when previous part ends with a digit', () => {
		const ref = baseRef({ name: null });
		const reserved = new Set<string>();
		const config = {
			...DEFAULT_CONFIG,
			fields: ['title', 'year'] as NamingField[],
			delimiterConditional: true,
			delimiter: '-'
		};
		const meta = { title: 'Alpha Part', year: '2020' };
		const suggestion = buildSuggestion(meta, ref, config, reserved);
		// "alpha_part" ends without digit => delimiter skipped
		expect(suggestion).toBe('alpha_part2020');
		const meta2 = { title: 'Part 1', year: '2020' };
		const suggestion2 = buildSuggestion(meta2, ref, config, new Set());
		expect(suggestion2).toBe('part_1-2020');
	});

	it('enforces uniqueness with numeric and latin increment styles', () => {
		const ref = baseRef({ name: null });
		const reserved = new Set<string>(['ref']);
		const configNumeric: typeof DEFAULT_CONFIG = {
			...DEFAULT_CONFIG,
			fields: ['title'] as NamingField[],
			incrementStyle: 'numeric' as IncrementStyle
		};
		const meta = { title: 'ref' };
		const numericSuggestion = buildSuggestion(meta, ref, configNumeric, reserved);
		expect(numericSuggestion).toBe('ref-2');

		const configLatin: typeof DEFAULT_CONFIG = {
			...DEFAULT_CONFIG,
			fields: ['title'] as NamingField[],
			incrementStyle: 'latin' as IncrementStyle
		};
		const latinSuggestion = buildSuggestion(meta, ref, configLatin, new Set(['ref']));
		expect(latinSuggestion).toBe('ref-a');
	});

	it('sanitizes punctuation, diacritics, casing, and spacing', () => {
		const ref = baseRef({ name: null });
		const reserved = new Set<string>();
		const config = {
			...DEFAULT_CONFIG,
			fields: ['title'] as NamingField[],
			stripPunctuation: true,
			stripDiacritics: true,
			lowercase: true,
			replaceSpaceWith: '_'
		};
		const meta = { title: 'Résumé: Test!' };
		const suggestion = buildSuggestion(meta, ref, config, reserved);
		expect(suggestion).toBe('resume_test');
	});

	it('uses yearAscii when convertYearDigits is true and year is non-ASCII', () => {
		const ref = baseRef({ name: null });
		const reserved = new Set<string>();
		const config = {
			...DEFAULT_CONFIG,
			fields: ['year'] as NamingField[],
			convertYearDigits: true
		};
		const meta = { year: undefined, yearAscii: '2020', domainShort: 'fallback' };
		const suggestion = buildSuggestion(meta, ref, config, reserved);
		expect(suggestion).toBe('2020');

		const configNoConvert = { ...config, convertYearDigits: false };
		const suggestionNoConvert = buildSuggestion(meta, ref, configNoConvert, new Set());
		// Falls back to other fields when year is missing
		expect(suggestionNoConvert).toBe('fallback');
	});

	it('falls back to alternative fields when requested parts are missing', () => {
		const ref = baseRef({ name: null, id: 'abc123' });
		const reserved = new Set<string>();
		const config = { ...DEFAULT_CONFIG, fields: ['year'] as NamingField[] };
		const meta = { title: 'My Article', domainShort: 'example' };
		const suggestion = buildSuggestion(meta, ref, config, reserved);
		expect(suggestion).toBe('my_article');
	});

	it('handles real-world citation with international chars and archive data', () => {
		const ref = baseRef({
			name: null,
			contentWikitext:
				'{{cite news |title=炸遊戲聯邦安全局犯法？3俄羅斯《Minecraft》玩家被判監最高9年｜科技玩物 |url=https://www.hk01.com/%E6%95%B8%E7%A2%BC%E7%94%9F%E6%B4%BB/733639/%E7%82%B8%E9%81%8A%E6%88%B2%E8%81%AF%E9%82%A6%E5%AE%89%E5%85%A8%E5%B1%80%E7%8A%AF%E6%B3%95-3%E4%BF%84%E7%BE%85%E6%96%AF-minecraft-%E7%8E%A9%E5%AE%B6%E8%A2%AB%E5%88%A4%E7%9B%A3%E6%9C%80%E9%AB%989%E5%B9%B4 |accessdate=2022-02-12 |work=香港01 |date=2022-02-09 |language=zh-HK |archive-date=2022-06-01 |archive-url=https://web.archive.org/web/20220601024341/https://www.hk01.com/%E6%95%B8%E7%A2%BC%E7%94%9F%E6%B4%BB/733639/%E7%82%B8%E9%81%8A%E6%88%B2%E8%81%AF%E9%82%A6%E5%AE%89%E5%85%A8%E5%B1%80%E7%8A%AF%E6%B3%95-3%E4%BF%84%E7%BE%85%E6%96%AF-minecraft-%E7%8E%A9%E5%AE%B6%E8%A2%AB%E5%88%A4%E7%9B%A3%E6%9C%80%E9%AB%989%E5%B9%B4 }}'
		});
		const meta = extractMetadata(ref);
		expect(meta.title).toContain('炸遊戲聯邦安全局犯法');
		expect(meta.work).toBe('香港01');
		expect(meta.domainShort).toBe('hk01');
		expect(meta.dateYMD).toBe('20220209');
		expect(meta.year).toBe('2022');
		const suggestion = buildSuggestion(meta, ref, createDefaultConfig(), new Set());
		expect(suggestion).toBe('hk01-20220209');
	});
});
