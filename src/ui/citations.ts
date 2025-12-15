import { getSettings, loadSettings } from './settings';
import { t } from '../i18n';
import popupStyles from './citations.css'
import { ensureStyleElement } from './codex';

const POPUP_STYLE_ELEMENT_ID = 'citeforge-ref-popup-styles';
const POPUP_ID = 'citeforge-ref-popup';
const DATA_ATTACHED = 'citeforgeAttached';

let popupStylesInjected = false;

/**
 * Inject popup styles into the document once.
 */
function injectPopupStyles(): void {
	if (popupStylesInjected) return;
	ensureStyleElement(POPUP_STYLE_ELEMENT_ID, popupStyles);
	popupStylesInjected = true;
}

let popupEl: HTMLDivElement | null = null;
let popupLink: HTMLAnchorElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let citationObserver: MutationObserver | null = null;
let referenceRootObserver: MutationObserver | null = null;
const observedReferenceLists = new WeakSet<HTMLOListElement>();

/**
 * Initialize the citation hover popup feature.
 * Creates a popup element that appears when hovering over citation superscripts,
 * allowing users to copy a permalink to the specific citation.
 * Uses MutationObserver to attach to dynamically added citations.
 */
export function initCitationPopup(): void {
	loadSettings();
	const settings = getSettings();
	if (!settings.showCiteRefCopyBtn) return;

	ensurePopup();

	document.querySelectorAll('sup[id^="cite_ref-"]').forEach((el) => attachCitationSup(el as HTMLElement));

	if (citationObserver) return;

	citationObserver = new MutationObserver((muts) => {
		for (const mutation of muts) {
			if (mutation.type !== 'childList' || !mutation.addedNodes?.length) continue;
			mutation.addedNodes.forEach((node) => scanCitationNodes(node));
		}
	});
	citationObserver.observe(document.body, { childList: true, subtree: true });
}

/**
 * Initialize the reference popup for copying reference permalinks.
 * Attaches hover/focus handlers to reference list items and tracks new lists dynamically.
 */
export function initReferencePopup(): void {
	loadSettings();
	const settings = getSettings();
	if (!settings.showCiteRefCopyBtn) return;

	ensurePopup();

	document
		.querySelectorAll<HTMLOListElement>('ol.references')
		.forEach((list) => attachReferenceList(list));

	if (referenceRootObserver) return;

	referenceRootObserver = new MutationObserver((muts) => {
		for (const mutation of muts) {
			if (mutation.type !== 'childList' || !mutation.addedNodes?.length) continue;
			mutation.addedNodes.forEach((node) => scanReferenceNodes(node));
		}
	});
	referenceRootObserver.observe(document.body, { childList: true, subtree: true });
}

function ensurePopup(): void {
	if (popupEl) return;

	injectPopupStyles();

	const popup = document.createElement('div');
	popup.id = POPUP_ID;
	popup.className = 'citeforge-ref-popup';
	popup.setAttribute('role', 'dialog');
	popup.setAttribute('aria-hidden', 'true');
	popup.style.display = 'none';
	popup.innerHTML = `<a href="#" class="citeforge-ref-popup-copy">${t('ui.citations.copy')}</a>`;
	document.body.appendChild(popup);

	popupEl = popup;
	popupLink = popup.querySelector<HTMLAnchorElement>('.citeforge-ref-popup-copy');

	popup.addEventListener('mouseenter', () => {
		if (hideTimer) clearTimeout(hideTimer);
	});
	popup.addEventListener('mouseleave', () => scheduleHide(120));

	popupLink?.addEventListener('click', handlePopupLinkClick);
	popupLink?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handlePopupLinkClick(e);
		}
	});
}

function handlePopupLinkClick(event: Event): void {
	event.preventDefault();
	if (!popupEl) return;

	const tgtId = popupEl.dataset.qeecTargetId;
	const linkText = popupEl.dataset.qeecLinkText || '';
	if (!tgtId) return;

	const revisionId = mw.config.get('wgRevisionId') || mw.config.get('wgCurRevisionId');
	const permalink = `Special:Permalink/${revisionId}`;
	const fullLink = `[[${permalink}#${tgtId}|#${linkText}]]`;

	void navigator.clipboard?.writeText(fullLink).catch(() => {
		try {
			document.execCommand('copy');
		} catch {
			/* ignore */
		}
	});

	if (!popupLink) return;
	const originalText = popupLink.textContent || '';
	popupLink.textContent = t('ui.default.copied');
	setTimeout(() => {
		if (popupLink) popupLink.textContent = originalText;
		scheduleHide(300);
	}, 900);
}

function scheduleHide(delay = 150): void {
	if (hideTimer) clearTimeout(hideTimer);
	if (!popupEl) return;

	hideTimer = setTimeout(() => {
		if (!popupEl) return;
		popupEl.classList.remove('is-open');
		popupEl.setAttribute('aria-hidden', 'true');
		setTimeout(() => {
			if (!popupEl || popupEl.classList.contains('is-open')) return;
			popupEl.style.display = 'none';
			delete popupEl.dataset.qeecTargetId;
			delete popupEl.dataset.qeecLinkText;
		}, 180);
	}, delay);
}

function openPopup(targetId: string, linkText: string): DOMRect | null {
	ensurePopup();
	if (!popupEl) return null;

	if (hideTimer) {
		clearTimeout(hideTimer);
		hideTimer = null;
	}

	popupEl.setAttribute('aria-hidden', 'false');
	if (popupLink) popupLink.textContent = t('ui.citations.copyPermalink');
	popupEl.style.display = 'block';
	popupEl.classList.add('is-open');
	popupEl.dataset.qeecTargetId = targetId;
	popupEl.dataset.qeecLinkText = linkText;

	return popupEl.getBoundingClientRect();
}

function attachCitationSup(sup: HTMLElement): void {
	if (!sup || sup.dataset[DATA_ATTACHED]) return;

	const supLink = sup.querySelector<HTMLAnchorElement>('a[href^="#cite_note-"]');
	if (!supLink) return;

	const linkText = computeCitationLinkText(sup, supLink);

	if (!sup.hasAttribute('tabindex')) sup.setAttribute('tabindex', '0');

	const onShow = () => showCitationPopup(sup, linkText);
	const onHide = () => scheduleHide(120);

	sup.addEventListener('mouseenter', onShow);
	sup.addEventListener('mouseleave', onHide);
	sup.addEventListener('focus', onShow);
	sup.addEventListener('blur', onHide);

	supLink.addEventListener('focus', onShow);
	supLink.addEventListener('blur', onHide);

	sup.dataset[DATA_ATTACHED] = '1';
}

function computeCitationLinkText(sup: HTMLElement, supLink: HTMLAnchorElement): string {
	let linkText = supLink.textContent?.replace(/^\[|]$/g, '') || '';
	let citeNoteStr = supLink.getAttribute('href')?.substring(11) || '';
	let citeRefStr = sup.id.substring(9);
	if (citeNoteStr === citeRefStr) return linkText;

	const linkTextCommon = commonPrefix(citeNoteStr, citeRefStr);
	citeNoteStr = citeNoteStr.substring(linkTextCommon.length + 1);
	citeRefStr = citeRefStr.substring(linkTextCommon.length + 1);
	if (citeNoteStr === citeRefStr) return linkText;

	const linkTextCommon2 = commonPrefix(citeNoteStr, citeRefStr);
	citeRefStr = citeRefStr.substring(linkTextCommon2.length + 1);
	if (citeRefStr) linkText = `${linkText}.${citeRefStr}`;

	return linkText;
}

function showCitationPopup(sup: HTMLElement, linkText: string): void {
	const targetId = sup.id;
	if (!targetId) return;

	const popupRect = openPopup(targetId, linkText);
	if (!popupEl || !popupRect) return;

	const rect = sup.getBoundingClientRect();
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

	popupEl.style.top = `${top}px`;
	popupEl.style.left = `${left}px`;
}

function scanCitationNodes(node: Node): void {
	if (!node) return;
	if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
		node.childNodes.forEach((child) => scanCitationNodes(child));
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return;

	const element = node as Element;
	if (element.matches('sup[id^="cite_ref-"]')) {
		attachCitationSup(element as HTMLElement);
	}
	element
		.querySelectorAll('sup[id^="cite_ref-"]')
		.forEach((sup) => attachCitationSup(sup as HTMLElement));
}

function attachReferenceList(list: HTMLOListElement): void {
	processReferenceList(list);
	if (observedReferenceLists.has(list)) return;

	const observer = new MutationObserver(() => processReferenceList(list));
	observer.observe(list, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['start', 'reversed', 'value']
	});
	observedReferenceLists.add(list);
}

function processReferenceList(list: HTMLOListElement): void {
	const items = getDirectReferenceItems(list);
	if (!items.length) return;

	const listStyle = window.getComputedStyle(list);
	const listStyleType = (listStyle.listStyleType || 'decimal').toLowerCase();
	const reversed = list.hasAttribute('reversed');
	const start = getListStartValue(list, items.length, reversed);
	let counter = start;

	items.forEach((li) => {
		const id = li.id;
		if (!id) return;

		const attr = Number.parseInt(li.getAttribute('value') ?? '', 10);
		const hasExplicitValue = !Number.isNaN(attr);
		const value = hasExplicitValue ? attr : counter;
		const markerText = formatListMarker(value, listStyleType);

		li.dataset.citeforgeMarker = markerText;
		attachReferenceItem(li);

		counter = reversed ? value - 1 : value + 1;
	});
}

function attachReferenceItem(li: HTMLLIElement): void {
	if (li.dataset[DATA_ATTACHED]) return;
	if (!li.hasAttribute('tabindex')) li.setAttribute('tabindex', '0');

	const onShow = () => showReferencePopup(li);
	const onHide = () => scheduleHide(120);

	li.addEventListener('mouseenter', onShow);
	li.addEventListener('mouseleave', onHide);
	li.addEventListener('focusin', onShow);
	li.addEventListener('focusout', onHide);

	li.dataset[DATA_ATTACHED] = '1';
}

function showReferencePopup(li: HTMLLIElement): void {
	if (!li.id) return;
	const marker = li.dataset.citeforgeMarker || '';

	const popupRect = openPopup(li.id, marker);
	if (!popupEl || !popupRect) return;

	const position = computeReferencePopupPosition(li, popupRect);
	popupEl.style.top = `${position.top}px`;
	popupEl.style.left = `${position.left}px`;
}

function computeReferencePopupPosition(li: HTMLLIElement, popupRect: DOMRect): { top: number; left: number } {
	const rect = li.getBoundingClientRect();

	let left = window.scrollX + rect.left;
	const minLeft = window.scrollX + 4;
	if (left < minLeft) left = minLeft;

	const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
	let top = window.scrollY + rect.top - popupRect.height;
	const minTop = window.scrollY + 4;
	const maxTop = window.scrollY + viewportHeight - popupRect.height - 4;
	if (top < minTop) top = minTop;
	if (top > maxTop) top = maxTop;

	return { top, left };
}

function getDirectReferenceItems(list: HTMLOListElement): HTMLLIElement[] {
	const items: HTMLLIElement[] = [];
	list.childNodes.forEach((node) => {
		if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() === 'li') {
			items.push(node as HTMLLIElement);
		}
	});
	return items;
}

function getListStartValue(list: HTMLOListElement, totalItems: number, reversed: boolean): number {
	const attr = Number.parseInt(list.getAttribute('start') ?? '', 10);
	if (!Number.isNaN(attr)) return attr;
	return reversed ? totalItems : 1;
}

function scanReferenceNodes(node: Node): void {
	if (!node) return;
	if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
		node.childNodes.forEach((child) => scanReferenceNodes(child));
		return;
	}
	if (node.nodeType !== Node.ELEMENT_NODE) return;

	const element = node as Element;
	if (element.matches('ol.references')) {
		attachReferenceList(element as HTMLOListElement);
	}
	element
		.querySelectorAll('ol.references')
		.forEach((list) => attachReferenceList(list as HTMLOListElement));
}

function formatListMarker(value: number, listStyleType: string): string {
	if (!Number.isFinite(value)) return String(value);
	const normalized = (listStyleType || '').toLowerCase();

	switch (normalized) {
		case 'decimal':
		case 'auto':
			return String(value);
		case 'decimal-leading-zero':
			return String(value).padStart(2, '0');
		case 'lower-alpha':
		case 'lower-latin':
			return numberToAlpha(value, false);
		case 'upper-alpha':
		case 'upper-latin':
			return numberToAlpha(value, true);
		case 'lower-roman':
			return numberToRoman(value).toLowerCase();
		case 'upper-roman':
			return numberToRoman(value);
		default:
			return String(value);
	}
}

function numberToAlpha(value: number, uppercase: boolean): string {
	if (value <= 0) return String(value);
	let num = value;
	let out = '';
	while (num > 0) {
		const remainder = (num - 1) % 26;
		out = String.fromCharCode(97 + remainder) + out;
		num = Math.floor((num - 1) / 26);
	}
	return uppercase ? out.toUpperCase() : out;
}

function numberToRoman(value: number): string {
	if (value <= 0) return String(value);
	const numerals: Array<[number, string]> = [
		[1000, 'M'],
		[900, 'CM'],
		[500, 'D'],
		[400, 'CD'],
		[100, 'C'],
		[90, 'XC'],
		[50, 'L'],
		[40, 'XL'],
		[10, 'X'],
		[9, 'IX'],
		[5, 'V'],
		[4, 'IV'],
		[1, 'I']
	];
	let remaining = Math.min(value, 3999);
	let result = '';
	for (const [num, symbol] of numerals) {
		while (remaining >= num) {
			result += symbol;
			remaining -= num;
		}
	}
	return result;
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
