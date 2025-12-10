import styles from './styles.css';

/**
 * Injects CSS styles into the document head.
 * @param css {string} - The CSS styles to inject.
 */
function injectStyles(css: string): void {
	if (!css) return;
	try {
		const styleEl = document.createElement('style');
		styleEl.appendChild(document.createTextNode(css));
		document.head.appendChild(styleEl);
	} catch (e) {
		// Fallback for older environments
		const div = document.createElement('div');
		div.innerHTML = `<style>${css}</style>`;
		document.head.appendChild(div.firstChild as any);
	}
}

/**
 * Entry point of the script.
 */
function init(): void {
	// Inject bundled CSS into the page.
	if (typeof document !== 'undefined') {
		injectStyles(styles);
	}

	mw.hook('wikipage.content').add(function () {

	});
}

init();