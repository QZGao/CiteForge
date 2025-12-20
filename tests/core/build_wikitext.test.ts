import { describe, it, expect } from 'vitest';
import { prefetchTemplateDataForWikitext } from '../../src/data/templatedata_fetch';

import {transformWikitext} from "../../src/core/build_wikitext";

describe('transformWikitext', () => {
	it('keeps wikitext unchanged when no transformations are specified', () => {
		const source = `
Intro <ref name="unchanged" /> mid <ref name="unchanged" /> end.<ref name="another-unchanged" />

==References==
{{reflist|refs=
<!-- No changes should be made here -->
<ref name="unchanged">This reference stays the same.</ref>
<ref name="another-unchanged">Another stable reference.</ref>
<!-- Even comments should remain intact. -->
}}
`;
		const result = transformWikitext(source, {});
		expect(result.wikitext).toBe(source); // No changes should be made, even for the comments in reflist
	});

	it('keeps wikitext positionally unchanged when only renaming is specified', () => {
		const source = `
Intro <ref name="unchanged" /> mid <ref name="unchanged" /> end.<ref name="another-unchanged" />

==References==
{{reflist|refs=
<!-- No changes should be made here -->
<ref name="unchanged">This reference stays the same.</ref>
<ref name="another-unchanged">Another stable reference.</ref>
<!-- Even comments should remain intact. -->
}}
`;
		const result = transformWikitext(source, {
			renameMap: { unchanged: 'still-unchanged', 'another-unchanged': 'also-unchanged' }
		});
		expect(result.wikitext).toBe(source.replace(/name="unchanged"/g, 'name="still-unchanged"').replace(/name="another-unchanged"/g, 'name="also-unchanged"'));
	});

	it('keeps wikitext positionally unchanged when only templateR is toggled, on or off', () => {
		const source1 = `
Intro <ref name="unchanged" /> mid <ref name="unchanged" /> end.<ref name="another-unchanged" />

==References==
{{reflist|refs=
<!-- No changes should be made here -->
<ref name="unchanged">This reference stays the same.</ref>
<ref name="another-unchanged">Another stable reference.</ref>
<!-- Even comments should remain intact. -->
}}
`;
		const source2 = source1.replace(/<ref name="unchanged" \/>/g, '{{r|unchanged}}').replace(/<ref name="another-unchanged" \/>/g, '{{r|another-unchanged}}');

		const result1 = transformWikitext(source1, { useTemplateR: true });
		expect(result1.wikitext).toBe(source2);

		const result2 = transformWikitext(source2, { useTemplateR: false });
		expect(result2.wikitext).toBe(source1);
	});

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

	it('applies content overrides when rewriting inline definitions', () => {
		const source = `
Body <ref name="foo">Original</ref> tail
`;
		const result = transformWikitext(source, {
			locationMode: 'keep',
			contentOverrides: { '::foo': 'Updated content' }
		});
		expect(result.wikitext).toContain('<ref name="foo">Updated content</ref>');
	});

	it('applies content overrides to list-defined references', () => {
		const source = `
Text <ref name="foo" />

{{reflist|refs=
<ref name="foo">Original</ref>
}}
`;
		const result = transformWikitext(source, {
			locationMode: 'all_ldr',
			contentOverrides: { '::foo': 'Updated LDR content' }
		});
		expect(result.wikitext).toContain('<ref name="foo">Updated LDR content</ref>');
	});

	it('moves <references> LDR definitions back inline and collapses the tag when empty', () => {
		const source = `
Intro <ref name="alpha" /> tail <ref name="beta" />

<references>
<ref name="alpha">Alpha content</ref>
<ref name="beta">Beta content</ref>
</references>
`;
		const result = transformWikitext(source, {
			locationMode: 'all_inline'
		});

		expect(result.wikitext).toContain('<ref name="alpha">Alpha content</ref>');
		expect(result.wikitext).toContain('<ref name="beta">Beta content</ref>');
		expect(result.wikitext).toContain('<references />');
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

	it('populates existing <references /> blocks with generated LDR entries', () => {
		const source = `
Lead <ref name="a">Alpha</ref> tail <ref name="b">Beta</ref>

<references />
`;

		const result = transformWikitext(source, {
			locationMode: 'all_ldr',
			sortRefs: false
		});

		expect(result.wikitext).toContain('<ref name="a" />');
		expect(result.wikitext).toContain('<ref name="b" />');
		expect(result.wikitext).toContain('<references>\n<ref name="a">Alpha</ref>\n<ref name="b">Beta</ref>\n</references>');
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

	it('preserves r-template page params alongside renamed refs', () => {
		const source = 'See {{r|foo|p=2|bar|p2=8-9}} for pages.';
		const result = transformWikitext(source, {
			renameMap: { foo: 'FooRenamed', bar: 'BarRenamed' },
			useTemplateR: true
		});

		expect(result.wikitext).toContain('{{r|FooRenamed|p=2|BarRenamed|p2=8-9}}');
	});

	it('converts r templates with only name/group to refs when templateR is off', () => {
		const source = 'See {{r|foo|grp=baz}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="baz" />');
		expect(result.wikitext).not.toContain('{{r|');
	});

	it('converts chained r templates with only name/group to refs when templateR is off', () => {
		const source = 'See {{r|n1=foo|grp=g1|bar|group=g2}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />');
		expect(result.wikitext).toContain('<ref name="bar" group="g2" />');
		expect(result.wikitext).not.toContain('{{r|');
	});

	it('converts refs with only name/group to r templates when templateR is on', () => {
		const source = 'See <ref name="foo" group="baz" />.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|group=baz}}');
		expect(result.wikitext).not.toContain('<ref ');
	});

	it('converts chained refs with only name/group to r templates when templateR is on', () => {
		const source = 'See <ref name="foo" group="g1" /><ref name="bar" group="g2" />.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|group=g1|bar|group=g2}}');
		expect(result.wikitext).not.toContain('<ref ');
	});

	it('converts r templates with page params to ref + rp when templateR is off', () => {
		const source = 'See {{r|foo|p=2}} and {{r|bar|pp=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" />{{rp|pp=4-5}}');
	});

	it('combines refs with rp back into r when templateR is on', () => {
		const source = 'See <ref name="foo" />{{rp|p=3}} and <ref name="bar" group="g" />{{rp|pp=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toMatch(/\{\{r\|foo\|p=3\}\}/);
		expect(result.wikitext).toMatch(/\{\{r\|bar\|group=g\|pp=4-5\}\}/);
	});

	it('combines chained refs with rp back into r when templateR is on', () => {
		const source = 'See <ref name="foo" />{{rp|p=2}}<ref name="bar" group="g" />{{rp|pp=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|p=2|bar|group2=g|pp2=4-5}}');
	});

	it('combines chained refs with rp back into r when templateR is on, longer example', () => {
		const source = 'See <ref name="foo" group="g1" />{{rp|p=2}}<ref name="bar" />{{rp|pp=4-5}}<ref name="baz" />{{rp|loc=fig1}}.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|group=g1|p=2|bar|pp2=4-5|baz|loc3=fig1}}');
	});

	it('keeps r templates with unsupported params when conversion would drop data', () => {
		const source = 'See {{r|foo|lang=en|p=2}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('{{r|foo|lang=en|p=2}}');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones', () => {
		const source = 'See {{r|foo|p=2|bar|lang2=en}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" />{{rp|p=2}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en}}');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones, longer example', () => {
		const source = 'See {{r|foo|grp=g1|p=2|bar|lang2=en|baz|pp3=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en}}');  // lang2 is unconvertible, so stays as r, but the index is removed
		expect(result.wikitext).toContain('<ref name="baz" />{{rp|pp=4-5}}');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones, even longer example', () => {
		const source = 'See {{r|foo|grp=g1|p=2|bar|lang2=en|baz|test3=4-5|fourth}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en|baz|test2=4-5}}');  // lang2 and test3 are unconvertible, so stay as r, but the indices are removed and renumbered; the two unconvertible stay chained
		expect(result.wikitext).toContain('<ref name="fourth" />');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones, when param order is mixed', () => {
		const source = 'See {{r|foo|lang2=en|lang3=fr|bar|pp=4-5|baz}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" />{{rp|pp=4-5}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en|baz|lang2=fr}}'); // lang2 and lang3 are unconvertible, so stay as r, but the indices are removed and renumbered; the two unconvertible stay chained
	});

	it('converts chained r with only name/group/page/pages/at into refs + rp when templateR is off', () => {
		const source = 'See {{r|foo|grp=g1|p=2|bar|grp2=g2|pp2=4-5}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" group="g2" />{{rp|pp=4-5}}');
	});

	it('converts chained r with only name/group/page/pages/at into refs + rp when templateR is off, even when param order is mixed', () => {
		const source = 'See {{r|foo|pp2=10-12|grp=g1|at3=fig1|bar|p=2|third}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" />{{rp|pp=10-12}}');
		expect(result.wikitext).toContain('<ref name="third" />{{rp|at=fig1}}');
	});

	it('recognizes name and its aliases when converting r to refs', () => {
		const source = 'See {{r|n1=foo|name2=bar|grp=g1|p=2|pages2=10-12|at3=fig1|3=baz}}.';
		const result = transformWikitext(source, { useTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" />{{rp|pages=10-12}}');
		expect(result.wikitext).toContain('<ref name="baz" />{{rp|at=fig1}}');
	});

	it('does not populate r-template params beyond what is associated with a ref', () => {
		const source = 'See {{r|eurogamer_20110728|p=2|youxichaguan_20231130}}.';
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toContain('{{r|eurogamer_20110728|p=2|youxichaguan_20231130}}');
	});

	it('does not remove line breaks', () => {
		const source = `| MC = PC：83/100{{r|metacritic_pc}}<br />{{tooltip|PS3|PlayStation 3}}：81/100{{r|metacritic_playstation-3}}
| OC = 76%{{r|opencritic}}`
		const result = transformWikitext(source, { useTemplateR: true });
		expect(result.wikitext).toBe(source);
	});

	it('renames and preserves all r-template aliases and indexed params when templateR is on', () => {
		const source = 'See {{r|name=alpha|grp=g1|p=2|pages2=10-12|at3=fig1}}.';
		const result = transformWikitext(source, {
			renameMap: { alpha: 'alpha-renamed' },
			useTemplateR: true
		});
		expect(result.wikitext).toContain('{{r|name=alpha-renamed|grp=g1|p=2|pages2=10-12|at3=fig1}}');
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

	it('normalizes ref content, test 1', async () => {
		const source = '<ref name="metacritic">{{Cite web|title=Gamersky|url=https://www.metacritic.com/publication/gamersky/|website=www.metacritic.com|language=en|access-date=2024-04-06|archive-date=2024-06-21|archive-url=https://web.archive.org/web/20240621172355/https://www.metacritic.com/publication/gamersky/|dead-url=no}}</ref>';
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true });
		expect(result.wikitext).toBe('<ref name="metacritic">{{Cite web |title=Gamersky |url=https://www.metacritic.com/publication/gamersky/ |website=www.metacritic.com |language=en |dead-url=no |archive-url=https://web.archive.org/web/20240621172355/https://www.metacritic.com/publication/gamersky/ |archive-date=2024-06-21 |access-date=2024-04-06}}</ref>');
	});

	it('normalizes ref content, test 2', async () => {
		const source = '<ref name="Custom maps">{{cite web|last=Savage|first=Phil|title=The 25 best Minecraft custom maps|url=http://www.pcgamer.com/2012/10/20/the-25-best-minecraft-custom-maps/|work=[[PC Gamer]]|publisher=[[Future plc]]|accessdate=2012-10-28|archive-url=https://web.archive.org/web/20121023211322/http://www.pcgamer.com/2012/10/20/the-25-best-minecraft-custom-maps/|archive-date=2012-10-23|dead-url=no}}</ref>';
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true });
		expect(result.wikitext).toBe('<ref name="Custom maps">{{cite web |title=The 25 best Minecraft custom maps |url=http://www.pcgamer.com/2012/10/20/the-25-best-minecraft-custom-maps/ |work=[[PC Gamer]] |last=Savage |first=Phil |dead-url=no |archive-url=https://web.archive.org/web/20121023211322/http://www.pcgamer.com/2012/10/20/the-25-best-minecraft-custom-maps/ |archive-date=2012-10-23 |accessdate=2012-10-28 |publisher=[[Future plc]]}}</ref>');
	});

	it('normalizes ref content, test 3', async () => {
		const source = `<ref name="OXMUK_20130510">{{Cite magazine |title=''Terraria'' – Can Re-Logic’s tile-based sandbox dig its way out of Minecraft’s shadow? |last=Borthwick |first=Ben |magazine=[[Official Xbox Magazine|Xbox 360: The Official Xbox Magazine (UK)]] |date=2013-05-10 |issue=99 (June 2013) |publisher=[[Future Publishing]] |pages=84–85 |language=en-GB |issn=1534-7850}}</ref>`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true });
		expect(result.wikitext).toBe(source);
	});

	it('normalizes ref content, test 4', async () => {
		const source = `<ref name="3dmgame_20150813">{{Cite news |title=神作依旧坚挺！《泰拉瑞亚》正式登陆Mac和Linux |url=https://www.3dmgame.com/news/201508/3515626.html |author=Sophie |work=[[3DMGAME]] |date=2015-08-13 |language=zh-Hans-CN |access-date=2025-08-11 |archive-url=https://web.archive.org/web/20170829055848/http://www.3dmgame.com/news/201508/3515626.html |archive-date=2017-08-29 |url-status=live}}</ref>`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true });
		expect(result.wikitext).toBe(source);
	});

	it('normalizes ref content, test 5', async () => {
		const source = `<ref name="4gamer_20110525">{{Cite web |url=https://www.4gamer.net/games/040/G004096/20110524056/ |website=[[4Gamer.net]] |date=2011-05-25 |script-title=ja:インディーズゲームの小部屋：Room＃182「Terraria」 |language=ja |author=ginger |url-status=live |archive-url=https://web.archive.org/web/20240420063819/https://www.4gamer.net/games/040/G004096/20110524056/ |archive-date=2024-04-20 |access-date=2025-08-23}}</ref>`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true });
		expect(result.wikitext).toBe(source);
	});
});
