# (WIP) Cite Hub

Unified reference workbench for Wikipedia wikitext pages. Inspect, search, copy, and prepare batch actions on citations in one floating panel.

## What it does

- Floating launcher (bottom-left) plus portlet toggle (“Show/Hide Cite Hub”) that remembers visibility across page loads.
- Alphabet index, sticky search bar, and inline refresh to browse all references; highlights uses in the article when selected.
- Hover popup on reference superscripts to copy permalinks; optional via settings.
- Copy ref names in multiple formats (raw, `{{r|name}}`, `<ref name="name" />`); toolbar buttons for upcoming mass rename/structure/check tools.
- Resizable, themable panel (adapts to light/dark/follow-OS skins) with size persisted locally; disabled in non-wikitext or disallowed namespaces.

## Installation

### Build manually

1) Install deps: `npm install`
2) Build: `npm run build` → outputs `dist/bundled.js` for the user script.
3) Upload `dist/bundled.js` to a wiki you control as a user script (e.g. [Special:MyPage/CiteHub.js](https://en.wikipedia.org/wiki/Special:MyPage/CiteHub.js) on English Wikipedia).
4) Open [Special:MyPage/global.js](https://meta.wikimedia.org/wiki/Special:MyPage/global.js) on Meta-Wiki, and add:

   ```js
   importScript('User:YourUsername/CiteHub.js'); // adjust path as needed
   ```

## Inspiration and prior work

- [QuickEditExt-Citations](https://www.github.com/QZGao/QuickEditExt-Citations)
