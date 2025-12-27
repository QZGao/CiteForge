# Cite Forge

Project page: [meta:Cite Forge](https://meta.wikimedia.org/wiki/Cite_Forge)

A citation management workbench for Wikipedia. Inspect, search, edit, and copy references from a floating panel.

## Features

### Navigation, copying, and export

Floating bottom-left panel with a portlet toggle; remembers visibility and size. Browse citations with an alphabetical index, search filter, and refresh. Highlight the uses of a citation in the article and can scroll to them. Copy ref names (raw, `{{r|name}}`, or `<ref name="..." />`) or raw citation content.

Hover popup offers quick copy on superscripts and references, and jumping between named citations and their inspector entries.

### Editing, transforms, and mass rename

Inline ref renaming (including nameless refs) with conflict detection and batch-queued saves.

Optional wikitext transforms: rename, dedupe, normalize ref markup, prefer `{{r}}` or `<ref>`, move refs inline↔LDR (all-inline, all-LDR, or threshold), sort reflist entries, keep copies vs dedupe, and rename nameless refs. Template support covers `<ref>`, self-closing `<ref />`, `{{r}}` (including chains), and reflist `refs=` blocks.

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

### Manual debugging from the browser console

You can test Cite Forge by pasting the bundle directly into a wiki tab:

1. Run `npm run build:debug`. The output appears at `.debug/bundled.js`.
2. Open that file, copy its entire contents, and switch to the wiki article you want to test.
3. Open the browser DevTools console (`F12`/`Ctrl+Shift+I`) on that page and paste the bundle. It bootstraps itself the same way the gadget loader does, so Cite Forge immediately mounts in the current tab.
4. When you rebuild, reload the wiki page and repeat the paste to pick up the changes. Keeping `npm run build:debug --watch` in another terminal helps rebuild automatically; you only need to re-paste after each build.

### VS Code debugging

The repository ships with a ready-to-run Firefox debugging workflow for VS Code. The `.debug/manifest.json` web extension installs a content script (`inject.js`) that injects the freshly built `.debug/bundled.js` bundle into any `*.wikipedia.org` page, letting you test Cite Forge like a normal gadget while still using VS Code breakpoints and sourcemaps.

1. Install the **Debugger for Firefox** extension in VS Code (it provides the `"firefox"` debug type).
2. Open the *Run and Debug* panel and select **Debug Cite Forge on Wikipedia**.
3. Press ▶️. The pre-launch task defined in `.vscode/tasks.json` runs `npm run watch:debug`, which keeps rebuilding `.debug/bundled.js` with inline sourcemaps.
4. VS Code launches Firefox to the URL from `launch.json` (default: `https://en.wikipedia.org/wiki/Terraria`) and sideloads the `.debug` extension. The debugger auto-reloads the page whenever `bundled.js`, `inject.js`, or `manifest.json` change, so edits + saves immediately refresh the gadget.
5. Set breakpoints anywhere in the TypeScript source; Firefox hits them against the rebuilt bundle thanks to the sourcemaps produced by the debug build.

Tip: Update `url` in `.vscode/launch.json` if you want the debug session to start on another article or wiki. Stop the debug session to terminate the `watch:debug` background task.

**Persisting cookies between sessions.** The Firefox debugger spins up a temporary profile every time, so your wiki login cookies disappear at the end of each run. To keep them, point the `.vscode/launch.json` at a reusable profile directory and tell the debugger to save changes:

```jsonc
{
 "name": "Debug Cite Forge on Wikipedia",
 // …
 "profileDir": "${workspaceFolder}/.debug/firefox-profile",
 "keepProfileChanges": true
}
```

The first launch will create the profile folder if it does not exist; afterwards your cookies, localStorage, and other profile data persist automatically. Delete `.debug/firefox-profile` whenever you want a clean slate.

**Disable the Meta-hosted loader while debugging.** If your user `common.js` (or `global.js`) loads the Meta-hosted script, add a guard to skip it when you are running the local debug extension:

```js
(() => {
  const isDev = localStorage.getItem('citeforge-dev') === '1';
  if (isDev) return;

  mw.loader.load("//meta.wikimedia.org/w/index.php?title=User:SuperGrey/gadgets/CiteForge.js&action=raw&ctype=text/javascript");
})();
```

The debug extension sets `localStorage["citeforge-dev"] = "1"` at `document_start`, so the remote loader is disabled for the debug profile. To restore the online version:

```js
localStorage.removeItem('citeforge-dev');
location.reload();
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
