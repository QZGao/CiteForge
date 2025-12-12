import { describe, it, expect } from 'vitest';
import { parseReferences, transformWikitext } from '../../src/core/references';

describe('parseReferences', () => {
	describe('named refs with content', () => {
		it('parses a simple named ref', () => {
			const wikitext = '<ref name="foo">Some citation content</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('foo');
			expect(refs[0].contentWikitext).toBe('Some citation content');
			expect(refs[0].group).toBeNull();
		});

		it('parses named ref with double quotes', () => {
			const wikitext = '<ref name="my-source">Content here</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('my-source');
		});

		it('parses named ref with single quotes', () => {
			const wikitext = "<ref name='single-quoted'>Content</ref>";
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('single-quoted');
		});

		it('parses named ref without quotes', () => {
			const wikitext = '<ref name=unquoted>Content</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('unquoted');
		});

		it('parses ref with group attribute', () => {
			const wikitext = '<ref name="foo" group="notes">A note</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('foo');
			expect(refs[0].group).toBe('notes');
		});
	});

	describe('self-closing refs', () => {
		it('parses self-closing named ref', () => {
			const wikitext = '<ref name="foo" />';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('foo');
			expect(refs[0].contentWikitext).toBe('');
		});

		it('parses self-closing ref without space before slash', () => {
			const wikitext = '<ref name="bar"/>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('bar');
		});

		it('parses self-closing ref with group', () => {
			const wikitext = '<ref name="foo" group="lower-alpha" />';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].group).toBe('lower-alpha');
		});
	});

	describe('multiple uses of same ref', () => {
		it('counts multiple uses of the same named ref', () => {
			const wikitext = `
				<ref name="source1">First source content</ref>
				Some text here.
				<ref name="source1" />
				More text.
				<ref name="source1" />
			`;
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('source1');
			expect(refs[0].uses.length).toBeGreaterThanOrEqual(3);
			expect(refs[0].contentWikitext).toBe('First source content');
		});

		it('preserves content from first definition', () => {
			const wikitext = `
				<ref name="myref">Original content</ref>
				<ref name="myref" />
			`;
			const refs = parseReferences(wikitext);

			expect(refs[0].contentWikitext).toBe('Original content');
		});
	});

	describe('{{r}} template syntax', () => {
		it('parses {{r|name}} template', () => {
			const wikitext = '{{r|Smith2020}}';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('Smith2020');
		});

		it('parses {{r|name=value}} template', () => {
			const wikitext = '{{r|name=Jones2019}}';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('Jones2019');
		});

		it('parses multiple r templates', () => {
			const wikitext = 'Text{{r|ref1}}more{{r|ref2}}end';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(2);
			expect(refs.map((r) => r.name)).toContain('ref1');
			expect(refs.map((r) => r.name)).toContain('ref2');
		});

		it('parses chained r template names', () => {
			const wikitext = '{{r|bilibili-05|sohu-02|dualshockers-01}}';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(3);
			expect(refs.map((r) => r.name)).toEqual(expect.arrayContaining(['bilibili-05', 'sohu-02', 'dualshockers-01']));
		});

		it('parses chained r template names with multiple segments', () => {
			const wikitext = '{{r|yicai-01|io.gov.mo-01}}';
			const refs = parseReferences(wikitext);
			expect(refs.map((r) => r.name)).toEqual(expect.arrayContaining(['yicai-01', 'io.gov.mo-01']));
		});
	});

	describe('unnamed refs', () => {
		it('parses unnamed ref with content', () => {
			const wikitext = '<ref>Anonymous citation</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBeNull();
			expect(refs[0].contentWikitext).toBe('Anonymous citation');
		});

		it('assigns unique IDs to multiple unnamed refs', () => {
			const wikitext = `
				<ref>First unnamed</ref>
				<ref>Second unnamed</ref>
			`;
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(2);
			expect(refs[0].id).not.toBe(refs[1].id);
		});
	});

	describe('sanitization', () => {
		it('ignores refs inside HTML comments', () => {
			const wikitext = `
				<ref name="visible">Real ref</ref>
				<!-- <ref name="hidden">Commented out</ref> -->
			`;
			const refs = parseReferences(wikitext);

			const names = refs.map((r) => r.name);
			expect(names).toContain('visible');
			expect(names).not.toContain('hidden');
		});

		it('ignores refs inside nowiki tags', () => {
			const wikitext = `
				<ref name="real">Content</ref>
				<nowiki><ref name="fake">Not a ref</ref></nowiki>
			`;
			const refs = parseReferences(wikitext);

			const names = refs.map((r) => r.name);
			expect(names).toContain('real');
			expect(names).not.toContain('fake');
		});

		it('ignores refs inside pre tags', () => {
			const wikitext = `
				<ref name="actual">Real</ref>
				<pre><ref name="example">Code example</ref></pre>
			`;
			const refs = parseReferences(wikitext);

			const names = refs.map((r) => r.name);
			expect(names).toContain('actual');
			expect(names).not.toContain('example');
		});
	});

	describe('complex wikitext', () => {
		it('handles mixed ref formats', () => {
			const wikitext = `
				According to sources<ref name="Smith2020">Smith, J. (2020)</ref>, 
				this is true.<ref name="Smith2020" /> See also<ref>Anonymous</ref> 
				and {{r|Jones2019}}.
			`;
			const refs = parseReferences(wikitext);

			expect(refs.length).toBeGreaterThanOrEqual(3);

			const smith = refs.find((r) => r.name === 'Smith2020');
			expect(smith).toBeDefined();
			expect(smith!.contentWikitext).toBe('Smith, J. (2020)');

			const jones = refs.find((r) => r.name === 'Jones2019');
			expect(jones).toBeDefined();
		});

		it('handles refs with complex content', () => {
			const wikitext = `<ref name="complex">{{cite web |url=https://example.com |title=Example}}</ref>`;
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].contentWikitext).toContain('cite web');
			expect(refs[0].contentWikitext).toContain('https://example.com');
		});

		it('handles multiline ref content', () => {
			const wikitext = `<ref name="multiline">
				{{cite book
				|author=John Doe
				|title=My Book
				|year=2020
				}}
			</ref>`;
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].contentWikitext).toContain('cite book');
			expect(refs[0].contentWikitext).toContain('John Doe');
		});
	});

	describe('edge cases', () => {
		it('returns empty array for empty string', () => {
			const refs = parseReferences('');
			expect(refs).toHaveLength(0);
		});

		it('returns empty array for text without refs', () => {
			const refs = parseReferences('Just some plain text without any references.');
			expect(refs).toHaveLength(0);
		});

		it('handles refs with special characters in names', () => {
			const wikitext = '<ref name="O\'Brien_2020">Content</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
		});

		it('handles refs with spaces in name attribute', () => {
			const wikitext = '<ref name = "spaced" >Content</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('spaced');
		});

		it('handles refs with slashes in names', () => {
			const wikitext = '<ref name="WP:RS/AC">Wikipedia reliable sources</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('WP:RS/AC');
			expect(refs[0].contentWikitext).toBe('Wikipedia reliable sources');
		});

		it('handles self-closing refs with slashes in names', () => {
			const wikitext = '<ref name="Category:Foo/Bar" />';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('Category:Foo/Bar');
		});

		it('handles multiple slashes in ref name', () => {
			const wikitext = '<ref name="a/b/c/d">Nested path ref</ref>';
			const refs = parseReferences(wikitext);

			expect(refs).toHaveLength(1);
			expect(refs[0].name).toBe('a/b/c/d');
		});
	});
});


describe('transformWikitext', () => {
	it('renames references across inline, self-closing, template r, and LDR definitions', () => {
		const source = `
Intro <ref name="foo">Alpha</ref> mid {{r|foo}} end <ref name="foo" />
Trailing use <ref name="bar" />

==References==
{{reflist|refs=
<ref name="bar">Bravo</ref>
}}
`;

		const result = transformWikitext(source, {
			renameMap: { foo: 'Foo2020', bar: 'Bar2021' },
			locationMode: 'all_inline',
			useTemplateR: true
		});

		expect(result.wikitext).toContain('<ref name="Foo2020">Alpha</ref>');
		expect(result.wikitext).toContain('{{r|Foo2020}}');
		expect(result.wikitext).toContain('<ref name="Bar2021">Bravo</ref>');
		expect(result.wikitext).not.toContain('name="foo"');
		expect(result.wikitext).not.toContain('name="bar"');
	});

	it('moves inline definitions to LDR and converts uses to self-closing', () => {
		const source = `
Text <ref name="c">Content C</ref> more <ref name="c" />

{{reflist}}
`;

		const result = transformWikitext(source, {
			locationMode: 'all_ldr',
			sortRefs: true
		});

		expect(result.wikitext).toContain('{{reflist|refs=');
		expect(result.wikitext).toContain('<ref name="c" />');
		expect(result.wikitext).toContain('<ref name="c">Content C</ref>');
	});

	it('moves LDR definitions back inline at first use', () => {
		const source = `
Intro <ref name="d" /> mid {{r|d}}

{{reflist|refs=
<ref name="d">Delta</ref>
}}
`;

		const result = transformWikitext(source, {
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref name="d">Delta</ref>');
		// Subsequent uses can remain {{r}} or ref; ensure the name was updated and reflist cleared
		expect(result.wikitext).toMatch(/({{r\|d}}|<ref name="d" \/>)/);
		expect(result.wikitext).not.toContain('|refs=');
	});

	it('deduplicates identical reference content and unifies names', () => {
		const source = `
<ref name="x">Same content</ref> text <ref name="y">Same content</ref>

{{reflist}}
`;

		const result = transformWikitext(source, {
			dedupe: true,
			locationMode: 'all_ldr',
			sortRefs: true
		});

		expect(result.wikitext).toContain('<ref name="x" />');
		expect(result.wikitext).toContain('{{reflist|refs=');
		expect(result.wikitext).toContain('<ref name="x">Same content</ref>');
		expect(result.wikitext).not.toContain('name="y">');
		expect(result.changes.deduped).toContainEqual({ from: 'y', to: 'x' });
	});

	it('applies threshold-based LDR placement', () => {
		const source = `
First <ref name="rare">Only once</ref>
Repeat <ref name="common">Common content</ref> and again <ref name="common" />

{{reflist}}
`;

		const result = transformWikitext(source, {
			locationMode: { minUsesForLdr: 2 },
			sortRefs: true
		});

		// "common" should be in LDR because it has 2 uses
		expect(result.wikitext).toContain('{{reflist|refs=');
		expect(result.wikitext).toContain('<ref name="common" />');
		expect(result.wikitext).toContain('<ref name="common">Common content</ref>');
		// "rare" should stay inline
		expect(result.wikitext).toContain('<ref name="rare">Only once</ref>');
	});

	it('handles chained r templates when renaming', () => {
		const source = 'See {{r|bilibili-05|sohu-02|dualshockers-01}} for details.';
		const result = transformWikitext(source, {
			renameMap: {
				'bilibili-05': 'bilibili-renamed',
				'sohu-02': 'sohu-renamed',
				'dualshockers-01': 'dualshockers-renamed'
			},
			useTemplateR: true
		});

		expect(result.wikitext).toContain('{{r|bilibili-renamed|sohu-renamed|dualshockers-renamed}}');
	});

	it('removes a ref name when mapped to null', () => {
		const source = 'Inline <ref name="temp">Body text</ref> end';
		const result = transformWikitext(source, {
			renameMap: { temp: null },
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref>Body text</ref>');
		expect(result.wikitext).not.toContain('name="temp"');
	});

	it('names an unnamed reference via renameNameless', () => {
		const source = 'Intro <ref>Nameless content</ref>';
		const result = transformWikitext(source, {
			renameNameless: { __nameless_0: 'NamedRef' },
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref name="NamedRef">Nameless content</ref>');
	});

	it('names one of multiple unnamed references', () => {
		const source = 'First <ref>Uno</ref> Second <ref>Dos</ref> Third <ref>Tres</ref>';
		const result = transformWikitext(source, {
			renameNameless: { __nameless_1: 'SecondRef' },
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref name="SecondRef">Dos</ref>');
		expect(result.wikitext).toContain('<ref>Uno</ref>');
		expect(result.wikitext).toContain('<ref>Tres</ref>');
	});

	it('names multiple unnamed references in order when not explicitly keyed', () => {
		const source = 'First <ref>Uno</ref> Second <ref>Dos</ref> Third <ref> Tres </ref>';
		const result = transformWikitext(source, {
			renameNameless: { a: 'RefA', b: 'RefB' },
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref name="RefA">Uno</ref>');
		expect(result.wikitext).toContain('<ref name="RefB">Dos</ref>');
		expect(result.wikitext).toContain('<ref>Tres</ref>');
	});
});
