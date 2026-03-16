// Run in page context so we can wait for MediaWiki globals before loading the bundle.
(function () {
	const current = document.currentScript;
	if (!current) return;

	const url = new URL(current.src);
	const bundleUrl = url.searchParams.get('bundle');
	const scriptId = url.searchParams.get('scriptId') || 'citeforge-debug-userscript';

	if (!bundleUrl) {
		console.warn('[Cite Forge debug] Missing bundled.js URL; skipping debug injection');
		return;
	}

	function loadCiteForge() {
		const old = document.getElementById(scriptId);
		if (old) old.remove();

		const script = document.createElement('script');
		script.id = scriptId;
		script.src = `${bundleUrl}${bundleUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
		(document.head || document.documentElement).appendChild(script);
	}

	function waitForMw() {
		if (typeof mw !== 'undefined' && mw.loader && typeof mw.loader.using === 'function') {
			loadCiteForge();
			return;
		}
		setTimeout(waitForMw, 50);
	}

	waitForMw();
})();
