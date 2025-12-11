import { describe, it, expect } from 'vitest';
import { parseReferences } from '../../src/core/references';

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
