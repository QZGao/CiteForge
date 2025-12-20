import { getSettings, loadSettings } from './settings';
import { t } from '../i18n';
import popupStyles from './citations.css';
import { ensureStyleElement } from './codex';
import { commonPrefix, numberToAlpha, numberToRoman } from '../core/string_utils';
import { jumpToInspectorTarget } from './inspector_loader';

const POPUP_STYLE_ELEMENT_ID = 'citeforge-ref-popup-styles';
const POPUP_ID = 'citeforge-ref-popup';
const DATA_ATTACHED = 'citeforgeAttached';
const POPUP_HAS_JUMP_CLASS = 'has-jump';

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
let popupCopyLink: HTMLAnchorElement | null = null;
let popupJumpLink: HTMLAnchorElement | null = null;
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

/**
 * Create the popup DOM element if it does not already exist and wire up
 * basic event listeners. This function also injects the required CSS.
 */
function ensurePopup(): void {
	if (popupEl) return;

	injectPopupStyles();

	const popup = document.createElement('div');
	popup.id = POPUP_ID;
	popup.className = 'citeforge-ref-popup';
	popup.setAttribute('role', 'dialog');
	popup.setAttribute('aria-hidden', 'true');
	popup.style.display = 'none';
	popup.innerHTML = `
		<div class="citeforge-ref-popup__actions">
			<a href="#" class="citeforge-ref-popup-copy">${t('ui.citations.copy')}</a>
			<span class="citeforge-ref-popup__divider" aria-hidden="true">|</span>
			<a href="#" class="citeforge-ref-popup-jump">${t('ui.citations.jumpToInspector')}</a>
		</div>`;
	document.body.appendChild(popup);

	popupEl = popup;
	popupCopyLink = popup.querySelector<HTMLAnchorElement>('.citeforge-ref-popup-copy');
	popupJumpLink = popup.querySelector<HTMLAnchorElement>('.citeforge-ref-popup-jump');

	popup.addEventListener('mouseenter', () => {
		if (hideTimer) clearTimeout(hideTimer);
	});
	popup.addEventListener('mouseleave', () => scheduleHide(120));

	popupCopyLink?.addEventListener('click', handlePopupCopyClick);
	popupCopyLink?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handlePopupCopyClick(e);
		}
	});
	popupJumpLink?.addEventListener('click', handleJumpLinkActivate);
	popupJumpLink?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			handleJumpLinkActivate(e);
		}
	});
}

/**
 * Click handler for the copy link inside the popup.
 * Copies a wiki-style permalink (with anchor) for the targeted citation or
 * reference into the clipboard and provides temporary UI feedback.
 * @param event - The click (or keyboard) event from the popup link.
 */
function handlePopupCopyClick(event: Event): void {
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
			// Legacy fallback for browsers without Clipboard API support
			const ta = document.createElement('textarea');
			ta.value = fullLink;
			ta.setAttribute('readonly', '');
			ta.style.position = 'fixed';
			ta.style.left = '-9999px';
			ta.style.top = '0';
			document.body.appendChild(ta);

			ta.focus();
			ta.select();

			document.execCommand('copy');
			document.body.removeChild(ta);
		} catch {
			/* ignore */
		}
	});

	if (!popupCopyLink) return;
	const originalText = popupCopyLink.textContent || '';
	popupCopyLink.textContent = t('ui.default.copied');
	setTimeout(() => {
		if (popupCopyLink) popupCopyLink.textContent = originalText;
		scheduleHide(300);
	}, 900);
}

function handleJumpLinkActivate(event: Event): void {
	event.preventDefault();
	if (!popupEl) return;
	if (popupEl.dataset.qeecJumpEnabled !== '1') return;
	const targetId = popupEl.dataset.qeecTargetId;
	if (!targetId) return;
	void jumpToInspectorTarget(targetId);
	scheduleHide(150);
}

/**
 * Schedule hiding the popup after an optional delay (milliseconds).
 * Clears any prior hide timer and transitions the popup out of the DOM
 * (while preserving the element for reuse).
 * @param delay - Milliseconds to wait before hiding the popup. Defaults to 150.
 */
function scheduleHide(delay = 150): void {
	if (hideTimer) clearTimeout(hideTimer);
	if (!popupEl) return;

	hideTimer = setTimeout(() => {
		if (!popupEl) return;
		popupEl.classList.remove('is-open');
		popupEl.classList.remove(POPUP_HAS_JUMP_CLASS);
		popupEl.setAttribute('aria-hidden', 'true');
		setTimeout(() => {
			if (!popupEl || popupEl.classList.contains('is-open')) return;
			popupEl.style.display = 'none';
			delete popupEl.dataset.qeecTargetId;
			delete popupEl.dataset.qeecLinkText;
			delete popupEl.dataset.qeecJumpEnabled;
		}, 180);
	}, delay);
}

/**
 * Open (show) the popup and attach metadata for the current target.
 * @param targetId - The id of the DOM element the popup is targeting.
 * @param linkText - The textual label (marker) to show/copy for the target.
 * @returns The popup's bounding ClientRect when shown, or `null` on failure.
 */
function openPopup(targetId: string, linkText: string, enableJump: boolean): DOMRect | null {
	ensurePopup();
	if (!popupEl) return null;

	if (hideTimer) {
		clearTimeout(hideTimer);
		hideTimer = null;
	}

	popupEl.setAttribute('aria-hidden', 'false');
	if (popupCopyLink) popupCopyLink.textContent = t('ui.citations.copyPermalink');
	popupEl.style.display = 'block';
	popupEl.classList.add('is-open');
	popupEl.classList.toggle(POPUP_HAS_JUMP_CLASS, enableJump);
	popupEl.dataset.qeecTargetId = targetId;
	popupEl.dataset.qeecLinkText = linkText;
	popupEl.dataset.qeecJumpEnabled = enableJump ? '1' : '0';
	if (popupJumpLink) {
		popupJumpLink.tabIndex = enableJump ? 0 : -1;
	}

	return popupEl.getBoundingClientRect();
}

/**
 * Attach mouse/keyboard handlers to a citation superscript element so the
 * popup shows on hover/focus. Marks the element as attached to avoid
 * duplicate listeners.
 * @param sup - The superscript element representing a citation (e.g. `sup[id^="cite_ref-"]`).
 */
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

/**
 * Derive a concise link text for a citation popup by comparing the
 * citation superscript id and the anchor href. Attempts to produce a
 * shorter, human-friendly suffix when there are shared prefixes.
 * @param sup - The superscript element for the citation.
 * @param supLink - The anchor element inside the superscript linking to the note.
 * @returns A concise string used as the popup label / permalink text.
 */
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

/**
 * Compute the top/left coordinates for a citation popup anchored to a
 * superscript element. The returned coordinates are clamped to the
 * viewport and will flip the popup below the element if there is not
 * enough space above.
 * @param sup - The citation superscript element to anchor the popup to.
 * @param popupRect - The bounding rect of the popup element.
 * @returns Object with `top` and `left` pixel coordinates.
 */
function computeCitationPopupPosition(sup: HTMLElement, popupRect: DOMRect): { top: number; left: number } {
	const rect = sup.getBoundingClientRect();
	const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
	const gap = 3;

	let top = window.scrollY + rect.top - popupRect.height - gap;
	let left = window.scrollX + rect.left - (popupRect.width - rect.width) / 2;

	if (top < window.scrollY + 4) {
		top = window.scrollY + rect.bottom + gap;
	}
	if (left + popupRect.width > window.scrollX + viewportWidth - 8) {
		left = window.scrollX + viewportWidth - popupRect.width - 8;
	}
	if (left < window.scrollX + 4) left = window.scrollX + 4;

	return { top, left };
}

/**
 * Show the citation popup for a given superscript element. This opens the
 * popup, populates its metadata, and positions it using
 * `computeCitationPopupPosition`.
 * @param sup - The citation superscript element to anchor the popup to.
 * @param linkText - The textual label for the popup (used for copying).
 */
function showCitationPopup(sup: HTMLElement, linkText: string): void {
	const targetId = sup.id;
	if (!targetId) return;

	const canJump = Boolean(sup.dataset?.citeforgeRefId);
	const popupRect = openPopup(targetId, linkText, canJump);
	if (!popupEl || !popupRect) return;

	const position = computeCitationPopupPosition(sup, popupRect);
	popupEl.style.top = `${position.top}px`;
	popupEl.style.left = `${position.left}px`;
}

/**
 * Walk a freshly-added DOM subtree and attach citation handlers to any
 * matching `sup[id^="cite_ref-"]` elements found within it.
 * @param node - Root node of the subtree that was added to the DOM.
 */
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

/**
 * Attach processing and a MutationObserver to an `ol.references` list so
 * that newly added/changed reference items are discovered and enhanced.
 * @param list - The ordered list element containing reference `<li>` items.
 */
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

/**
 * Enumerate the direct <li> children of the reference list and attach the
 * popup handlers. Also computes a textual marker for each list item based
 * on the list style and any explicit numbering.
 * @param list - The ordered list element to process.
 */
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

/**
 * Attach event handlers to an individual reference <li> so the popup shows
 * when hovered or focused. Marks the element as attached to avoid double
 * wiring.
 * @param li - The list item element representing a reference.
 */
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

/**
 * Show the popup for a reference list item and position it appropriately.
 * @param li - The reference list item to anchor the popup to.
 */
function showReferencePopup(li: HTMLLIElement): void {
	if (!li.id) return;
	const marker = li.dataset.citeforgeMarker || '';
	const canJump = Boolean(li.dataset.citeforgeRefId);

	const popupRect = openPopup(li.id, marker, canJump);
	if (!popupEl || !popupRect) return;

	const position = computeReferencePopupPosition(li, popupRect);
	popupEl.style.top = `${position.top}px`;
	popupEl.style.left = `${position.left}px`;
}

/**
 * Compute a suitable top/left position for the reference popup so it stays
 * within the viewport while aligning near the target list item.
 * @param li - The reference list item used as the anchor.
 * @param popupRect - The bounding rect of the popup element.
 * @returns An object with `top` and `left` pixel values for positioning.
 */
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

/**
 * Return only the direct <li> children of the given <ol> element. This
 * ignores nested lists and other descendant nodes.
 * @param list - The ordered list element whose direct <li> children should be returned.
 * @returns An array containing the direct `<li>` children of `list`.
 */
function getDirectReferenceItems(list: HTMLOListElement): HTMLLIElement[] {
	const items: HTMLLIElement[] = [];
	list.childNodes.forEach((node) => {
		if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() === 'li') {
			items.push(node as HTMLLIElement);
		}
	});
	return items;
}

/**
 * Determine the starting numeric value for a list, respecting an explicit
 * `start` attribute or the `reversed` attribute when present.
 * @param list - The ordered list element to inspect.
 * @param totalItems - The total number of direct items in the list.
 * @param reversed - Whether the list is reversed.
 * @returns The numeric start value for list numbering.
 */
function getListStartValue(list: HTMLOListElement, totalItems: number, reversed: boolean): number {
	const attr = Number.parseInt(list.getAttribute('start') ?? '', 10);
	if (!Number.isNaN(attr)) return attr;
	return reversed ? totalItems : 1;
}

/**
 * Walk a newly-added DOM subtree and attach reference-list handling to any
 * `ol.references` elements found within it.
 * @param node - Root node of the subtree that was added to the DOM.
 */
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

/**
 * Format a numeric list marker according to `list-style-type` semantics.
 * Supports decimal, leading-zero, alpha (upper/lower) and Roman numerals.
 * @param value - Numeric value to format.
 * @param listStyleType - The computed `list-style-type` string from CSS.
 * @returns A textual representation of the list marker for `value`.
 */
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
