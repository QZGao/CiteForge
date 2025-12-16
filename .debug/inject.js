// Inject bundled.js into the page context after page loads
(function () {
	const bundleUrl = browser.runtime.getURL('bundled.js');

	function inject() {
		// Create inline script that waits for mw.loader then loads our bundle
		const waitScript = document.createElement('script');
		waitScript.textContent = `
			(function() {
				function loadCiteForge() {
					const script = document.createElement('script');
					script.src = ${JSON.stringify(bundleUrl)};
					document.head.appendChild(script);
				}
				
				if (typeof mw !== 'undefined' && mw.loader && typeof mw.loader.using === 'function') {
					loadCiteForge();
				} else {
					// Fallback: wait for mw.loader
					setTimeout(function retry() {
						if (typeof mw !== 'undefined' && mw.loader && typeof mw.loader.using === 'function') {
							loadCiteForge();
						} else {
							setTimeout(retry, 50);
						}
					}, 50);
				}
			})();
		`;
		(document.head || document.documentElement).appendChild(waitScript);
		waitScript.remove();
	}

	// Wait for page to finish loading
	if (document.readyState === 'complete') {
		inject();
	} else {
		window.addEventListener('load', inject);
	}
})();
