import { getSettings, loadSettings } from './settings';

const POPUP_ID = 'citeforge-ref-popup';
const DATA_ATTACHED = 'citeforgeAttached';

/**
 * Initialize the citation hover popup feature.
 * Creates a popup element that appears when hovering over citation superscripts,
 * allowing users to copy a permalink to the specific citation.
 * Uses MutationObserver to attach to dynamically added citations.
 */
export function initCitationPopup(): void {
	loadSettings();
	if (document.getElementById(POPUP_ID)) return;

	const popup = document.createElement('div');
	popup.id = POPUP_ID;
	popup.className = 'citeforge-ref-popup';
	popup.setAttribute('role', 'dialog');
	popup.setAttribute('aria-hidden', 'true');
	popup.style.display = 'none';
	popup.innerHTML = '<a href="#" class="citeforge-ref-popup-copy">Copy</a>';
	document.body.appendChild(popup);

	const popupLink = popup.querySelector<HTMLAnchorElement>('.citeforge-ref-popup-copy');
	let hideTimer: ReturnType<typeof setTimeout> | null = null;

	function scheduleHide(delay = 150): void {
		if (hideTimer) clearTimeout(hideTimer);
		hideTimer = setTimeout(() => {
			popup.classList.remove('is-open');
			popup.setAttribute('aria-hidden', 'true');
			setTimeout(() => {
				if (!popup.classList.contains('is-open')) {
					popup.style.display = 'none';
					delete (popup as HTMLElement).dataset.qeecTargetId;
					delete (popup as HTMLElement).dataset.qeecLinkText;
				}
			}, 180);
		}, delay);
	}

	function showPopupForSup(sup: HTMLElement, linkText: string): void {
		if (!sup || !popup) return;
		if (hideTimer) clearTimeout(hideTimer);
		popup.setAttribute('aria-hidden', 'false');
		if (popupLink) popupLink.textContent = 'Copy permalink';

		popup.style.display = 'block';
		popup.classList.add('is-open');

		const rect = sup.getBoundingClientRect();
		const popupRect = popup.getBoundingClientRect();
		const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);

		const gap = 3;
		let top = window.scrollY + rect.top - popupRect.height - gap;
		let left = window.scrollX + rect.left;

		if (top < window.scrollY + 4) {
			top = window.scrollY + rect.bottom + gap;
		}
		if (left + popupRect.width > window.scrollX + viewportWidth - 8) {
			left = window.scrollX + viewportWidth - popupRect.width - 8;
		}
		if (left < window.scrollX + 4) left = window.scrollX + 4;

		popup.style.top = `${top}px`;
		popup.style.left = `${left}px`;

		(popup as HTMLElement).dataset.qeecTargetId = sup.id;
		(popup as HTMLElement).dataset.qeecLinkText = linkText;
	}

	popup.addEventListener('mouseenter', () => {
		if (hideTimer) clearTimeout(hideTimer);
	});
	popup.addEventListener('mouseleave', () => scheduleHide(120));

	popupLink?.addEventListener('click', (e) => {
		e.preventDefault();
		const tgtId = (popup as HTMLElement).dataset.qeecTargetId;
		const linkText = (popup as HTMLElement).dataset.qeecLinkText || '';
		if (!tgtId) return;
		const pageName = mw.config.get('wgPageName');
		const fullLink = `[[${pageName}#${tgtId}|#${linkText}]]`;
		void navigator.clipboard?.writeText(fullLink).catch(() => {
			try {
				document.execCommand('copy');
			} catch {
				/* ignore */
			}
		});
		if (popupLink) {
			const originalText = popupLink.textContent;
			popupLink.textContent = 'Copied!';
			setTimeout(() => {
				if (popupLink) popupLink.textContent = originalText;
				scheduleHide(300);
			}, 900);
		}
	});

	popupLink?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			popupLink.click();
		}
	});

	const settings = getSettings();
	if (!settings.showCiteRefCopyBtn) return;

	const attachToSup = (sup: HTMLElement): void => {
		if (!sup || sup.dataset[DATA_ATTACHED]) return;
		const supLink = sup.querySelector('a[href^="#cite_note-"]');
		if (!supLink) return;

		let linkText = supLink.textContent?.replace(/^\[|]$/g, '') || '';
		let citeNoteStr = supLink.getAttribute('href')?.substring(11) || '';
		let citeRefStr = sup.id.substring(9);
		if (citeNoteStr !== citeRefStr) {
			const linkTextCommon = commonPrefix(citeNoteStr, citeRefStr);
			citeNoteStr = citeNoteStr.substring(linkTextCommon.length + 1);
			citeRefStr = citeRefStr.substring(linkTextCommon.length + 1);
			if (citeNoteStr !== citeRefStr) {
				const linkTextCommon2 = commonPrefix(citeNoteStr, citeRefStr);
				citeRefStr = citeRefStr.substring(linkTextCommon2.length + 1);
				if (citeRefStr) linkText = `${linkText}.${citeRefStr}`;
			}
		}

		if (!sup.hasAttribute('tabindex')) sup.setAttribute('tabindex', '0');

		const onShow = () => showPopupForSup(sup, linkText);
		const onHide = () => scheduleHide(120);

		sup.addEventListener('mouseenter', onShow);
		sup.addEventListener('mouseleave', onHide);
		sup.addEventListener('focus', onShow);
		sup.addEventListener('blur', onHide);

		supLink.addEventListener('focus', onShow);
		supLink.addEventListener('blur', onHide);

		sup.dataset[DATA_ATTACHED] = '1';
	};

	const supElements = document.querySelectorAll('sup[id^="cite_ref-"]');
	supElements.forEach((el) => attachToSup(el as HTMLElement));

	const mo = new MutationObserver((muts) => {
		for (const m of muts) {
			if (m.type === 'childList' && m.addedNodes?.length) {
				m.addedNodes.forEach((node) => {
					if (!node || node.nodeType !== 1) return;
					if ((node as Element).matches?.('sup[id^="cite_ref-"]')) {
						attachToSup(node as HTMLElement);
					} else {
						const nested = (node as Element).querySelectorAll?.('sup[id^="cite_ref-"]');
						nested?.forEach((el) => attachToSup(el as HTMLElement));
					}
				});
			}
		}
	});
	mo.observe(document.body, { childList: true, subtree: true });
}

/**
 * Find the common prefix of two strings.
 * Used to extract the shared portion of cite note and cite ref IDs.
 * @param a - First string to compare.
 * @param b - Second string to compare.
 * @returns The longest common prefix of both strings.
 */
function commonPrefix(a: string, b: string): string {
	const len = Math.min(a.length, b.length);
	let i = 0;
	while (i < len && a.charAt(i) === b.charAt(i)) i++;
	return a.substring(0, i);
}
