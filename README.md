# Cite Forge

Project page: [meta:Cite Forge](https://meta.wikimedia.org/wiki/Cite_Forge)

A citation management workbench for Wikipedia. Inspect, search, edit, and copy references from a floating panel.

## Features

### Panel and navigation

Floating bottom-left panel with a portlet toggle; remembers visibility and size. Browse citations with an alphabetical index, search filter, and refresh. Selecting a reference highlights its uses in the article and can scroll to them. Based on the existing UI from [QuickEditExt-Citations](https://github.com/QZGao/QuickEditExt-Citations).

### Editing and transforms

Inline ref renaming (including nameless refs) with conflict detection and batch-queued saves. Optional wikitext transforms: rename, dedupe, normalize ref markup, prefer `{{r}}` or `<ref>`, move refs inline↔LDR (all-inline, all-LDR, or threshold), sort reflist entries, keep copies vs dedupe, and rename nameless refs. Template support covers `<ref>`, self-closing `<ref />`, `{{r}}` (including chains), and reflist `refs=` blocks.

### Copying and export

Copy ref names (raw, `{{r|name}}`, or `<ref name="..." />`) or raw citation content. Hover popup offers quick copy on superscripts. “Save to diff” applies transforms and opens the standard MediaWiki diff (no direct API saves).

### Mass renamer

Pick multiple naming parts (author/title/work/domain/year/full date/etc.), choose collision suffix styles, and control punctuation/diacritic handling. Generated renames feed back into the inspector’s pending changes for diff preview. Inspired by [RefRenamer](https://en.wikipedia.org/wiki/User:Nardog/RefRenamer).

### Harv checks

Marks CS1/CS2 style and surfaces Harv link/target issues, page-range anomalies, COinS metadata gaps, and sorting/duplicate problems (adapted from [reviewsourcecheck](https://en.wikipedia.org/wiki/User:Lingzhi2/reviewsourcecheck)/[HarvErrors](https://en.wikipedia.org/wiki/User:Ucucha/HarvErrors)).

## Installation

### Distributed build

To use Cite Forge on one of the supported wikis, or install it on all wikis:

- For one wiki: Add the following line to your `common.js` page on that wiki ( e.g. [English Wikipedia `common.js`](https://en.wikipedia.org/wiki/Special:MyPage/common.js) ).
- For all wikis: Add the following line to your [`global.js` page on Meta-Wiki](https://meta.wikimedia.org/wiki/Special:MyPage/global.js).

```js
mw.loader.load("//meta.wikimedia.org/w/index.php?title=User:SuperGrey/gadgets/CiteForge.js&action=raw&ctype=text/javascript"); // Backlink: [[meta:Cite Forge]]
```

### Build from source

```bash
npm install
npm run build
```

Upload `dist/bundled.js` to your wiki userspace (e.g., `User:YourName/CiteForge.js`), then load it via your `common.js` or `global.js` page:

```js
mw.loader.load('//meta.wikimedia.org/w/index.php?title=User:YourName/CiteForge.js&action=raw&ctype=text/javascript');
```

## Development

```bash
npm run build:debug   # Build with sourcemaps
npm run lint          # ESLint check
npm test              # Run Vitest tests
```

## Credits

- Icons and assets from:
  - [Codex](https://doc.wikimedia.org/codex/latest/) (MIT and CC BY 4.0) by Wikimedia Foundation
  - [Codicons](https://github.com/microsoft/vscode-codicons) (MIT and CC BY 4.0) by Microsoft
- Inspired by the following works:
  - [QuickEditExt-Citations](https://github.com/QZGao/QuickEditExt-Citations) (MIT) by SuperGrey
  - [refOrganizer](https://github.com/QZGao/refOrganizer) and its upstream [refCon](https://github.com/Cumbril/refcon) (GNU GPL 3.0) by Kaniivel, SuperGrey, et al.
  - [ProveIt](https://en.wikipedia.org/wiki/Wikipedia:ProveIt) (CC BY-SA 3.0 and GPL 2.0) by [ProveIt contributors](https://www.mediawiki.org/wiki/ProveIt#Credits)
  - [RefRenamer](https://en.wikipedia.org/wiki/User:Nardog/RefRenamer) (CC BY-SA 4.0) by Nardog
  - [Citation Style Marker](https://en.wikipedia.org/wiki/User:BrandonXLF/CitationStyleMarker) (CC BY-SA 4.0) by BrandonXLF
  - [HarvErrors](https://en.wikipedia.org/wiki/User:Ucucha/HarvErrors) (CC BY-SA 4.0) by Ucucha
  - [reviewsourcecheck](https://en.wikipedia.org/wiki/User:Lingzhi2/reviewsourcecheck) (CC BY-SA 4.0) by Lingzhi & Ucucha
