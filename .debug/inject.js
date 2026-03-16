// Inject bundled.js into the page context after page loads
(function () {
	const SCRIPT_ID = 'citeforge-debug-userscript';
	const BOOTSTRAP_ID = 'citeforge-debug-bootstrap';
	const DEV_STORAGE_KEY = 'citeforge-dev';
	const runtime =
		(typeof browser !== 'undefined' && browser.runtime) ||
		(typeof chrome !== 'undefined' && chrome.runtime) ||
		null;

	if (!runtime || typeof runtime.getURL !== 'function') {
		console.warn('[Cite Forge debug] Extension runtime API unavailable; skipping debug injection');
		return;
	}

	const bundleUrl = runtime.getURL('bundled.js');
	const bootstrapUrl = new URL(runtime.getURL('page_bootstrap.js'));
	bootstrapUrl.searchParams.set('bundle', bundleUrl);
	bootstrapUrl.searchParams.set('scriptId', SCRIPT_ID);

	function markDevMode() {
		if (localStorage.getItem(DEV_STORAGE_KEY) !== '1') {
			localStorage.setItem(DEV_STORAGE_KEY, '1');
		}
	}

	markDevMode();

	function inject() {
		const old = document.getElementById(BOOTSTRAP_ID);
		if (old) old.remove();

		const bootstrap = document.createElement('script');
		bootstrap.id = BOOTSTRAP_ID;
		bootstrap.src = `${bootstrapUrl.toString()}&t=${Date.now()}`;
		(document.head || document.documentElement).appendChild(bootstrap);
	}

	// Wait for page to finish loading
	if (document.readyState === 'complete') {
		inject();
	} else {
		window.addEventListener('load', inject);
	}
})();
