/**
 * Inject CSS text into the document head.
 */
export function injectStyles(css: string): void {
  if (!css) return;
  try {
    const styleEl = document.createElement('style');
    styleEl.appendChild(document.createTextNode(css));
    document.head.appendChild(styleEl);
  } catch {
    // Fallback for older environments
    const div = document.createElement('div');
    div.innerHTML = `<style>${css}</style>`;
    document.head.appendChild(div.firstChild as HTMLElement);
  }
}
