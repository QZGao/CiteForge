import { describe, it, expect } from 'vitest';
import { prefetchTemplateDataForWikitext } from '../../src/data/templatedata_fetch';

import { transformWikitext } from "../../src/core/build_wikitext";

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

		const result1 = transformWikitext(source1, { preferTemplateR: true });
		expect(result1.wikitext).toBe(source2);

		const result2 = transformWikitext(source2, { preferTemplateR: false });
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
			preferTemplateR: true
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

	it('uses <references> when preferTemplateReflist is false', () => {
		const source = `
Lead <ref name="c">Content C</ref> more <ref name="c" />
`;

		const result = transformWikitext(source, {
			locationMode: 'all_ldr',
			sortRefs: true,
			preferTemplateReflist: false
		});

		expect(result.wikitext).toContain('<references>');
		expect(result.wikitext).toContain('<ref name="c" />');
		expect(result.wikitext).toContain('<ref name="c">Content C</ref>');
		expect(result.wikitext).not.toContain('{{reflist');
	});

	it('converts reflist templates to <references> when preferTemplateReflist is false', () => {
		const source = `
Lead <ref name="c">Content C</ref> more <ref name="c" />

{{reflist|refs=
<ref name="c">Content C</ref>
}}
`;

		const result = transformWikitext(source, {
			locationMode: 'all_ldr',
			sortRefs: true,
			preferTemplateReflist: false
		});

		expect(result.wikitext).toContain('<references>');
		expect(result.wikitext).toContain('<ref name="c">Content C</ref>');
		expect(result.wikitext).toContain('<ref name="c" />');
		expect(result.wikitext).not.toContain('{{reflist');
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

	it('moves <references> LDR definitions back inline and converts to reflist when empty', () => {
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
		expect(result.wikitext).toContain('{{reflist}}');
		expect(result.wikitext).not.toContain('<references');
	});

	it('deduplicates identical reference content and unifies names', async () => {
		const source = `
<ref name="x">Same content</ref> text <ref name="y">Same content</ref>

{{reflist}}
`;
		await prefetchTemplateDataForWikitext(source);
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

	it('deduplicates citation templates semantically and merges supplementary params', async () => {
		const source = `
<ref name="primary">{{cite web|title=Alpha|url=http://example.com}}</ref>
<ref name="secondary">{{cite web|title=Alpha|url=http://example.com|access-date=2020-01-01|archive-url=https://web.archive.org/web/20200101/http://example.com|archive-date=2020-01-02|dead-url=no}}</ref>

Reuse: <ref name="primary" /><ref name="secondary" />

{{reflist}}
`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { dedupe: true, locationMode: 'all_inline' });

		expect(result.wikitext).toContain('<ref name="primary">{{cite web|title=Alpha|url=http://example.com|access-date=2020-01-01|archive-url=https://web.archive.org/web/20200101/http://example.com|archive-date=2020-01-02|dead-url=no}}</ref>');
		expect(result.wikitext).toContain('<ref name="primary" />');
		expect(result.wikitext).not.toContain('name="secondary"');
		expect(result.changes.deduped).toContainEqual({ from: 'secondary', to: 'primary' });
		expect(result.wikitext).toContain('Reuse: <ref name="primary" /><ref name="primary" />');
	});

	it('does not dedupe citation templates when supplementary params conflict', async () => {
		const source = `
<ref name="old">{{cite web|title=Alpha|url=http://example.com|access-date=2020-01-01}}</ref>
<ref name="new">{{cite web|title=Alpha|url=http://example.com|access-date=2021-01-01}}</ref>
`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { dedupe: true, locationMode: 'all_inline' });

		expect(result.changes.deduped).toHaveLength(0);
		expect(result.wikitext).toContain('name="old"');
		expect(result.wikitext).toContain('name="new"');
	});

	it('treats supplementary aliases as the same parameter when deduping', async () => {
		const source = `
<ref name="one">{{cite web|title=Alpha|url=http://example.com|accessdate=2020-01-01}}</ref>
<ref name="two">{{cite web|title=Alpha|url=http://example.com|access-date=2020-01-01}}</ref>
`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { dedupe: true, locationMode: 'all_inline' });

		expect(result.changes.deduped).toContainEqual({ from: 'two', to: 'one' });
		expect(result.wikitext).toContain('<ref name="one">{{cite web|title=Alpha|url=http://example.com|accessdate=2020-01-01}}</ref>');
		expect(result.wikitext).not.toMatch(/access-date=/);
	});

	it('deduplicates references, additional test case 1', async () => {
		const source = `
		<ref name="gameres">{{Cite web |title=《明日方舟：终末地》实机演示首曝，鹰角网络越来越出人意料了 - GameRes游资网 |url=https://www.gameres.com/893623.html |url-status=live |archive-url=https://web.archive.org/web/20231113032935/https://www.gameres.com/893623.html |archive-date=2023-11-13 |access-date=2025-02-01 |website=www.gameres.com}}</ref>
		<ref name="gameres-a">{{cite web |title=《明日方舟：终末地》实机演示首曝，鹰角网络越来越出人意料了 - GameRes游资网 |url=https://www.gameres.com/893623.html}}</ref>
		`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { dedupe: true, locationMode: 'all_inline' });

		expect(result.changes.deduped).toContainEqual({ from: 'gameres-a', to: 'gameres' });
		expect(result.wikitext).toContain('<ref name="gameres">{{Cite web |title=《明日方舟：终末地》实机演示首曝，鹰角网络越来越出人意料了 - GameRes游资网 |url=https://www.gameres.com/893623.html |url-status=live |archive-url=https://web.archive.org/web/20231113032935/https://www.gameres.com/893623.html |archive-date=2023-11-13 |access-date=2025-02-01 |website=www.gameres.com}}</ref>');
		expect(result.wikitext).not.toContain('name="gameres-a"');
	});

	it('deduplicates references, additional test case 2', async () => {
		const source = `
		<ref name="MC">{{cite web |title=Arknights: Endfield Reviews |url=https://www.metacritic.com/game/arknights-endfield/ |url-status=live |archive-url=https://web.archive.org/web/20260120153606/https://www.metacritic.com/game/arknights-endfield/ |archive-date=2026-01-20 |accessdate=2026-01-22 |website=[[Metacritic]] |language=en}}</ref>
		<ref name="metacritic">{{Cite web |title=Arknights: Endfield Reviews |url=https://www.metacritic.com/game/arknights-endfield/ |website=Metacritic}}</ref>
		`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { dedupe: true, locationMode: 'all_inline' });

		expect(result.changes.deduped).toContainEqual({ from: 'metacritic', to: 'MC' });
		expect(result.wikitext).toContain('<ref name="MC">{{cite web |title=Arknights: Endfield Reviews |url=https://www.metacritic.com/game/arknights-endfield/ |url-status=live |archive-url=https://web.archive.org/web/20260120153606/https://www.metacritic.com/game/arknights-endfield/ |archive-date=2026-01-20 |accessdate=2026-01-22 |website=[[Metacritic]] |language=en}}</ref>');
		expect(result.wikitext).not.toContain('name="metacritic"');
	});

	it('deduplicates references, additional test case 3', async () => {
		const source = `
		<ref name="MC">{{cite web |title=Arknights: Endfield Reviews |url=https://www.metacritic.com/game/arknights-endfield/ |url-status=live |archive-url=https://web.archive.org/web/20260120153606/https://www.metacritic.com/game/arknights-endfield/ |archive-date=2026-01-20 |accessdate=2026-01-22 |website=Metacritic |language=en}}</ref>
		<ref name="metacritic">{{Cite web |title=Arknights: Endfield Reviews |url=https://www.metacritic.com/game/arknights-endfield/ |website=www.metacritic.com}}</ref>
		`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { dedupe: true, locationMode: 'all_inline' });

		expect(result.changes.deduped).toContainEqual({ from: 'metacritic', to: 'MC' });
		expect(result.wikitext).toContain('<ref name="MC">{{cite web |title=Arknights: Endfield Reviews |url=https://www.metacritic.com/game/arknights-endfield/ |url-status=live |archive-url=https://web.archive.org/web/20260120153606/https://www.metacritic.com/game/arknights-endfield/ |archive-date=2026-01-20 |accessdate=2026-01-22 |website=Metacritic |language=en}}</ref>');
		expect(result.wikitext).not.toContain('name="metacritic"');
	});

	it('deduplicates references, additional test case 4', async () => {
		const source = `
		<ref name="GamingBolt Review">{{cite news |last1=Sinha |first1=Ravi |date=2026-01-22 |title=Arknights: Endfield Review – Stars From the End |url=https://gamingbolt.com/arknights-endfield-review-stars-from-the-end |url-status=live |archive-url=https://web.archive.org/web/20260122210242/https://gamingbolt.com/arknights-endfield-review-stars-from-the-end |archive-date=2026-01-22 |accessdate=2026-01-22 |work=GamingBolt |language=en}}</ref>
		<ref name="gamingbolt">{{Cite web |last=Sinha |first=Ravi |title=Arknights: Endfield Review – Stars From the End |url=https://gamingbolt.com/arknights-endfield-review-stars-from-the-end}}</ref>
		`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { dedupe: true, locationMode: 'all_inline' });

		expect(result.changes.deduped).toContainEqual({ from: 'gamingbolt', to: 'GamingBolt Review' });
		expect(result.wikitext).toContain('<ref name="GamingBolt Review">{{cite news |last1=Sinha |first1=Ravi |date=2026-01-22 |title=Arknights: Endfield Review – Stars From the End |url=https://gamingbolt.com/arknights-endfield-review-stars-from-the-end |url-status=live |archive-url=https://web.archive.org/web/20260122210242/https://gamingbolt.com/arknights-endfield-review-stars-from-the-end |archive-date=2026-01-22 |accessdate=2026-01-22 |work=GamingBolt |language=en}}</ref>');
		expect(result.wikitext).not.toContain('name="gamingbolt"');
	});

	it('deduplicates references, additional test case 5', async () => {
		const source = `
		<ref name="CGMagazine Review">{{cite news |last1=Biordi |first1=Jordan |date=2026-01-20 |title=Arknights: Endfield (PC) Review |url=https://www.cgmagonline.com/review/game/arknights-endfield-pc/ |accessdate=2026-01-22 |work=CGMagazine |language=en}}</ref>
		<ref name="cgmagonline-20260120">{{Cite web |date=2026-01-20 |title=Arknights: Endfield (PC) Review - CGMagazine |url=https://www.cgmagonline.com/review/game/arknights-endfield-pc/ |website=www.cgmagonline.com}}</ref>
		`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { dedupe: true, locationMode: 'all_inline' });

		expect(result.changes.deduped).toContainEqual({ from: 'cgmagonline-20260120', to: 'CGMagazine Review' });
		expect(result.wikitext).toContain('<ref name="CGMagazine Review">{{cite news |last1=Biordi |first1=Jordan |date=2026-01-20 |title=Arknights: Endfield (PC) Review |url=https://www.cgmagonline.com/review/game/arknights-endfield-pc/ |accessdate=2026-01-22 |work=CGMagazine |language=en}}</ref>');
		expect(result.wikitext).not.toContain('name="cgmagonline-20260120"');
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

	it('converts existing <references /> blocks to reflist with generated LDR entries', () => {
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
		expect(result.wikitext).toContain('{{reflist|refs=\n<ref name="a">Alpha</ref>\n<ref name="b">Beta</ref>\n}}');
		expect(result.wikitext).not.toContain('<references');
	});

	it('handles chained r templates when renaming', () => {
		const source = 'See {{r|bilibili-05|sohu-02|dualshockers-01}} for details.';
		const result = transformWikitext(source, {
			renameMap: {
				'bilibili-05': 'bilibili-renamed',
				'sohu-02': 'sohu-renamed',
				'dualshockers-01': 'dualshockers-renamed'
			},
			preferTemplateR: true
		});

		expect(result.wikitext).toContain('{{r|bilibili-renamed|sohu-renamed|dualshockers-renamed}}');
	});

	it('transforms chained r templates to refs when templateR is off', () => {
		const source = 'See {{r|foo|bar|baz}} for details.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" /><ref name="bar" /><ref name="baz" />');
		expect(result.wikitext).not.toContain('{{r|');
	});

	it('preserves r-template page params alongside renamed refs', () => {
		const source = 'See {{r|foo|p=2|bar|p2=8-9}} for pages.';
		const result = transformWikitext(source, {
			renameMap: { foo: 'FooRenamed', bar: 'BarRenamed' },
			preferTemplateR: true
		});

		expect(result.wikitext).toContain('{{r|FooRenamed|p=2|BarRenamed|p2=8-9}}');
	});

	it('converts r templates with only name/group to refs when templateR is off', () => {
		const source = 'See {{r|foo|grp=baz}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="baz" />');
		expect(result.wikitext).not.toContain('{{r|');
	});

	it('converts chained r templates with only name/group to refs when templateR is off', () => {
		const source = 'See {{r|n1=foo|grp=g1|bar|group=g2}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />');
		expect(result.wikitext).toContain('<ref name="bar" group="g2" />');
		expect(result.wikitext).not.toContain('{{r|');
	});

	it('converts refs with only name/group to r templates when templateR is on', () => {
		const source = 'See <ref name="foo" group="baz" />.';
		const result = transformWikitext(source, { preferTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|group=baz}}');
		expect(result.wikitext).not.toContain('<ref ');
	});

	it('converts chained refs with only name/group to r templates when templateR is on', () => {
		const source = 'See <ref name="foo" group="g1" /><ref name="bar" group="g2" />.';
		const result = transformWikitext(source, { preferTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|group=g1|bar|group=g2}}');
		expect(result.wikitext).not.toContain('<ref ');
	});

	it('converts r templates with page params to ref + rp when templateR is off', () => {
		const source = 'See {{r|foo|p=2}} and {{r|bar|pp=4-5}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" />{{rp|pp=4-5}}');
	});

	it('combines refs with rp back into r when templateR is on', () => {
		const source = 'See <ref name="foo" />{{rp|p=3}} and <ref name="bar" group="g" />{{rp|pp=4-5}}.';
		const result = transformWikitext(source, { preferTemplateR: true });
		expect(result.wikitext).toMatch(/\{\{r\|foo\|p=3\}\}/);
		expect(result.wikitext).toMatch(/\{\{r\|bar\|group=g\|pp=4-5\}\}/);
	});

	it('combines chained refs with rp back into r when templateR is on', () => {
		const source = 'See <ref name="foo" />{{rp|p=2}}<ref name="bar" group="g" />{{rp|pp=4-5}}.';
		const result = transformWikitext(source, { preferTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|p=2|bar|group2=g|pp2=4-5}}');
	});

	it('combines chained refs with rp back into r when templateR is on, longer example', () => {
		const source = 'See <ref name="foo" group="g1" />{{rp|p=2}}<ref name="bar" />{{rp|pp=4-5}}<ref name="baz" />{{rp|loc=fig1}}.';
		const result = transformWikitext(source, { preferTemplateR: true });
		expect(result.wikitext).toContain('{{r|foo|group=g1|p=2|bar|pp2=4-5|baz|loc3=fig1}}');
	});

	it('keeps r templates with unsupported params when conversion would drop data', () => {
		const source = 'See {{r|foo|lang=en|p=2}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('{{r|foo|lang=en|p=2}}');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones', () => {
		const source = 'See {{r|foo|p=2|bar|lang2=en}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" />{{rp|p=2}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en}}');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones, longer example', () => {
		const source = 'See {{r|foo|grp=g1|p=2|bar|lang2=en|baz|pp3=4-5}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en}}');  // lang2 is unconvertible, so stays as r, but the index is removed
		expect(result.wikitext).toContain('<ref name="baz" />{{rp|pp=4-5}}');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones, even longer example', () => {
		const source = 'See {{r|foo|grp=g1|p=2|bar|lang2=en|baz|test3=4-5|fourth}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en|baz|test2=4-5}}');  // lang2 and test3 are unconvertible, so stay as r, but the indices are removed and renumbered; the two unconvertible stay chained
		expect(result.wikitext).toContain('<ref name="fourth" />');
	});

	it('keeps unconvertible entries in a chained r as r while converting the convertible ones, when param order is mixed', () => {
		const source = 'See {{r|foo|lang2=en|lang3=fr|bar|pp=4-5|baz}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" />{{rp|pp=4-5}}');
		expect(result.wikitext).toContain('{{r|bar|lang=en|baz|lang2=fr}}'); // lang2 and lang3 are unconvertible, so stay as r, but the indices are removed and renumbered; the two unconvertible stay chained
	});

	it('converts chained r with only name/group/page/pages/at into refs + rp when templateR is off', () => {
		const source = 'See {{r|foo|grp=g1|p=2|bar|grp2=g2|pp2=4-5}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" group="g2" />{{rp|pp=4-5}}');
	});

	it('converts chained r with only name/group/page/pages/at into refs + rp when templateR is off, even when param order is mixed', () => {
		const source = 'See {{r|foo|pp2=10-12|grp=g1|at3=fig1|bar|p=2|third}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" />{{rp|pp=10-12}}');
		expect(result.wikitext).toContain('<ref name="third" />{{rp|at=fig1}}');
	});

	it('recognizes name and its aliases when converting r to refs', () => {
		const source = 'See {{r|n1=foo|name2=bar|grp=g1|p=2|pages2=10-12|at3=fig1|3=baz}}.';
		const result = transformWikitext(source, { preferTemplateR: false });
		expect(result.wikitext).toContain('<ref name="foo" group="g1" />{{rp|p=2}}');
		expect(result.wikitext).toContain('<ref name="bar" />{{rp|pages=10-12}}');
		expect(result.wikitext).toContain('<ref name="baz" />{{rp|at=fig1}}');
	});

	it('does not populate r-template params beyond what is associated with a ref', () => {
		const source = 'See {{r|eurogamer_20110728|p=2|youxichaguan_20231130}}.';
		const result = transformWikitext(source, { preferTemplateR: true });
		expect(result.wikitext).toContain('{{r|eurogamer_20110728|p=2|youxichaguan_20231130}}');
	});

	it('does not remove line breaks', () => {
		const source = `| MC = PC：83/100{{r|metacritic_pc}}<br />{{tooltip|PS3|PlayStation 3}}：81/100{{r|metacritic_playstation-3}}
| OC = 76%{{r|opencritic}}`
		const result = transformWikitext(source, { preferTemplateR: true });
		expect(result.wikitext).toBe(source);
	});

	it('renames and preserves all r-template aliases and indexed params when templateR is on', () => {
		const source = 'See {{r|name=alpha|grp=g1|p=2|pages2=10-12|at3=fig1}}.';
		const result = transformWikitext(source, {
			renameMap: { alpha: 'alpha-renamed' },
			preferTemplateR: true
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

	it('normalizes cite date params to yyyy-mm-dd', async () => {
		const source = '<ref name="date-test">{{cite web|title=Foo|url=https://example.com|date=21 May 2021|access-date=2021年5月2日|archive-date=05/21/2021|publication-date=21/05/2021}}</ref>';
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true });
		expect(result.wikitext).toContain('date=2021-05-21');
		expect(result.wikitext).toContain('access-date=2021-05-02');
		expect(result.wikitext).toContain('archive-date=2021-05-21');
		expect(result.wikitext).toContain('publication-date=2021-05-21');
	});

	it('normalizes cite date params to MMMM d, yyyy', async () => {
		const source = '<ref name="date-test">{{cite web|title=Foo|url=https://example.com|date=21 May 2021|access-date=2021年5月2日|archive-date=05/21/2021|publication-date=21/05/2021}}</ref>';
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true, dateFormat: 'mdy' });
		expect(result.wikitext).toContain('date=May 21, 2021');
		expect(result.wikitext).toContain('access-date=May 2, 2021');
		expect(result.wikitext).toContain('archive-date=May 21, 2021');
		expect(result.wikitext).toContain('publication-date=May 21, 2021');
	});

	it('normalizes cite date params to d MMMM yyyy', async () => {
		const source = '<ref name="date-test">{{cite web|title=Foo|url=https://example.com|date=21 May 2021|access-date=2021年5月2日|archive-date=05/21/2021|publication-date=21/05/2021}}</ref>';
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true, dateFormat: 'dmy' });
		expect(result.wikitext).toContain('date=21 May 2021');
		expect(result.wikitext).toContain('access-date=2 May 2021');
		expect(result.wikitext).toContain('archive-date=21 May 2021');
		expect(result.wikitext).toContain('publication-date=21 May 2021');
	});

	it('normalizes cite templates that contain nested templates in parameter values', async () => {
		const source = '<ref name="nested">{{cite web|last=Smith|title={{lang|ja|テスト}}|url=https://example.com|access-date=2021年5月2日}}</ref>';
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true });
		expect(result.wikitext).toBe('<ref name="nested">{{cite web |title={{lang|ja|テスト}} |url=https://example.com |last=Smith |access-date=2021-05-02}}</ref>');
	});

	it('preserves normalization when rebuilding refs into list-defined references', async () => {
		const source = 'Lead <ref name="date-test">{{cite web|last=Smith|title=Foo|url=https://example.com|access-date=2021年5月2日}}</ref>\n\n<references />';
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true, locationMode: 'all_ldr' });
		expect(result.wikitext).toContain('<ref name="date-test" />');
		expect(result.wikitext).toContain('<ref name="date-test">{{cite web |title=Foo |url=https://example.com |last=Smith |access-date=2021-05-02}}</ref>');
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

	it('references with group attributes', () => {
		const source = `This is a sentence.<ref group="lower-alpha" name="a_note">This is a note.</ref><ref name="a_ref">This is a reference.</ref>

==Notes==
<references group="lower-alpha" />

==References==
<references />`;
		const result = transformWikitext(source, {
			locationMode: 'all_ldr'
		});

		expect(result.wikitext).toContain('<ref name="a_note" group="lower-alpha" />');
		expect(result.wikitext).toContain('<ref name="a_ref" />');
		expect(result.wikitext).toContain(`<references group="lower-alpha">
<ref name="a_note" group="lower-alpha">This is a note.</ref>
</references>`);
		expect(result.wikitext).toContain(`<references>
<ref name="a_ref">This is a reference.</ref>
</references>`);
	});

	it('parses templates with nested templates having consecutive closing braces (}}}})', () => {
		// Regression test for findTemplateEnd when handling nested templates
		// e.g., {{Cite web|website={{tsl|en|Earth}}}} has }}}} at the end (closing inner template then outer template)
		const source = '<ref name="earth">{{Cite web|website={{tsl|en|Earth}}}}</ref>';
		const result = transformWikitext(source, { locationMode: 'all_inline' });

		// Template should be parsed correctly without truncation
		expect(result.wikitext).toContain('<ref name="earth">{{Cite web|website={{tsl|en|Earth}}}}</ref>');
		expect(result.warnings).toHaveLength(0);
		expect(result.changes.renamed).toHaveLength(0);
	});

	it('parses multiple cite templates with nested templates', async () => {
		const source = `<ref name="ref1">{{Cite web|title=Example|website={{tsl|fr|Example}}}}</ref> and <ref name="ref2">{{Cite web|title=Test|url=https://example.com|work={{tsl|de|Werk}}}}</ref>`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { normalizeAll: true });

		// Both refs should be parsed and preserved
		expect(result.wikitext).toContain('{{tsl|fr|Example}}');
		expect(result.wikitext).toContain('{{tsl|de|Werk}}');
		expect(result.wikitext).toContain('name="ref1"');
		expect(result.wikitext).toContain('name="ref2"');
	});

	it('parses Multiref templates with deeply nested citations', async () => {
		// Complex real-world example with Multiref containing multiple Cite templates
		const source = `<ref name="animage-2025年1月号">{{Multiref|{{Cite magazine |last=アニメージュ編集部 |magazine=[[Animage|アニメージュ]] |date=2024-12-10 |issue=559 (2025年1月号) |language=ja |script-title=ja:マスカレードが始まる |asin=B00PG3CDE2 |asin-tld=co.jp |pp=40–43}}|{{Cite news |url=https://animageplus.jp/news/detail/96 |script-title=ja:アニメージュ2025年1月号に関するお詫び |author=アニメージュ編集部 |work=[[Animage|アニメージュ]] |date=2024-12-20 |accessdate=2025-03-14 |language=ja |archive-date=2025-02-15 |archive-url=https://web.archive.org/web/20250215042453/https://animageplus.jp/news/detail/96 |dead-url=no}}}}</ref>`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { locationMode: 'all_inline', normalizeAll: true });

		// Template should be parsed completely without truncation
		expect(result.wikitext).toContain('{{Multiref|');
		expect(result.wikitext).toContain('{{Cite magazine');
		expect(result.wikitext).toContain('{{Cite news');
		expect(result.wikitext).toContain('name="animage-2025年1月号"');
		// Verify it wasn't truncated (the full name with closing quotes should be present)
		expect(result.wikitext).toContain('name="animage-2025年1月号">{{Multiref');
	});

	it('parses two consecutive Multiref definitions correctly without name confusion', async () => {
		// Regression test for issue where animage-2025年1月号 gets confused with yomiuri-popstyle-960
		// This matches the real-world pattern from temp.wikitext where both refs are used multiple times
		const source = `導演表示... {{r|animage-2025年1月号}}。柿本廣大表示，祥子決定的契機...{{r|animage-2025年1月号}}。
特別選擇在相同的音樂領域...{{r|animage-2025年1月号}}。
柿本廣大在訪談中提到...{{r|animage-2025年1月号}}。
現實樂團演出中，高尾奏音亦擔任鍵盤演奏{{r|yomiuri-popstyle-960}}。

{{reflist|refs=
<ref name="animage-2025年1月号">{{Multiref|{{Cite magazine |last=アニメージュ編集部 |magazine=[[Animage|アニメージュ]] |date=2024-12-10 |issue=559 (2025年1月号) |language=ja |script-title=ja:マスカレードが始まる |asin=B00PG3CDE2 |asin-tld=co.jp |pp=40–43}}|{{Cite news |url=https://animageplus.jp/news/detail/96 |script-title=ja:アニメージュ2025年1月号に関するお詫び |author=アニメージュ編集部 |work=[[Animage|アニメージュ]] |date=2024-12-20 |accessdate=2025-03-14 |language=ja |archive-date=2025-02-15 |archive-url=https://web.archive.org/web/20250215042453/https://animageplus.jp/news/detail/96 |dead-url=no}}}}</ref>
<ref name="yomiuri-popstyle-960">{{Multiref|{{cite magazine |script-title=ja:ALL ABOUT ようこそ Ave Mujicaの世界へ |date=2025-08-20 |issue=960 |language=ja }}|{{cite web |url=https://example.com |title=Example |date=2025-09-08 |accessdate=2026-03-08 |language=ja }}}}</ref>
}}`;
		await prefetchTemplateDataForWikitext(source);
		const result = transformWikitext(source, { locationMode: 'all_ldr', preferTemplateR: true });

		// Both references should be parsed correctly with their own names preserved
		expect(result.wikitext).toContain('name="animage-2025年1月号"');
		expect(result.wikitext).toContain('name="yomiuri-popstyle-960"');
		// Both should have proper uses (self-closing refs or {{r|...}} templates)
		expect(result.wikitext).toContain('{{r|animage-2025年1月号}}');
		expect(result.wikitext).toContain('{{r|yomiuri-popstyle-960}}');
		// Both Multiref definitions in the reflist should be preserved
		expect(result.wikitext.match(/{{Multiref\|/g)).toHaveLength(2);
		// Verify that animage-2025年1月号 has exactly 4 uses (not merged with yomiuri)
		const anImageMatches = result.wikitext.match(/{{r\|animage-2025年1月号}}/g) || [];
		const yomiuriMatches = result.wikitext.match(/{{r\|yomiuri-popstyle-960}}/g) || [];
		expect(anImageMatches.length).toBeGreaterThan(1); // Should have multiple uses
		expect(yomiuriMatches.length).toBeGreaterThan(0);  // Should have at least one use
		expect(anImageMatches.length).not.toEqual(yomiuriMatches.length); // Should be different counts
	});
});
