import { parse as parseDomain } from 'tldts';

/**
 * Convert any Unicode digit to its ASCII counterpart.
 * @param value - String containing digits.
 * @returns String with all digits converted to ASCII.
 */
export function convertDigitsToAscii(value: string): string {
	return value.replace(/\p{Nd}/gu, (d) => {
		const cp = d.codePointAt(0) ?? 0;
		let zero = cp;
		while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) {
			zero--;
		}
		return String((cp - zero) % 10);
	});
}

/**
 * Strip basic wikitext/HTML markup for token extraction.
 * @param text - Raw wikitext or HTML snippet.
 * @returns Plain text with markup removed.
 */
export function stripMarkup(text: string): string {
	let t = String(text || '');
	t = t.replace(/<!--[\s\S]*?-->/g, ' ');
	t = t.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, ' ');
	t = t.replace(/<[^>]+>/g, ' ');
	// Extract inner text from language templates like {{lang|ja|やわらぎ}} before stripping templates.
	t = t.replace(/\{\{\s*lang[-_a-z]*\s*\|[^|}]*\|([^{}]*?)\}\}/gi, '$1');
	t = t.replace(/\{\{[^{}]*\}\}/g, ' ');
	t = t.replace(/\[https?:\/\/[^\s\]]+(?:\s+([^\]]+))?\]/g, '$1');
	t = t.replace(/\[\[([^|\]]*\|)?([^\]]+)\]\]/g, '$2');
	t = t.replace(/''+/g, '');
	return t.replace(/\s+/g, ' ').trim();
}

export interface YearCandidate {
	original: string;
	ascii: string;
}

/**
 * Find the first plausible four-digit year in a string.
 * @param value - Text to scan.
 * @returns YearCandidate object or null if none found.
 */
export function firstYearCandidate(value: string): YearCandidate | null {
	if (!value) return null;
	const ascii = convertDigitsToAscii(value);
	const match = ascii.match(/(?:^|\D)(\d{4})(?!\d)/);
	if (!match || !match[1]) return null;
	const year = match[1];
	const originalMatch = value.match(/(?:^|\D)(\d{4})(?!\d)/);
	return { original: originalMatch?.[1] ?? year, ascii: year };
}

/**
 * Extract the first URL-like token from text.
 * @param content - String to search.
 * @returns Extracted URL or null if none found.
 */
export function extractUrl(content: string): string | null {
	const match = content.match(/https?:\/\/[^\s|<>"]+/i);
	return match ? match[0] : null;
}

/**
 * Get domain (without public suffix) from a URL.
 * @param url - URL string.
 * @return Domain without suffix or null if parsing fails.
 */
export function domainShortFromUrl(url: string): string | null {
	try {
		const res = parseDomain(url);
		return res.domainWithoutSuffix || res.domain || null;
	} catch {
		return null;
	}
}

/**
 * Get domain from a URL, stripping leading www.
 * @param url - URL string.
 * @return Domain or null if parsing fails.
 */
export function domainFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url, 'https://example.com');
		const host = parsed.hostname || '';
		return host.replace(/^www\./, '') || null;
	} catch {
		return null;
	}
}

/**
 * Normalize a reference name to a lowercase ASCII key.
 * @param name - Raw reference name.
 * @returns Normalized name key.
 */
export function normalizeNameKey(name: string): string {
	if (!name) return '';
	const ascii = convertDigitsToAscii(name).normalize('NFD').replace(/\p{Mn}/gu, '');
	return ascii.toLowerCase().replace(/[\s_]+/g, '_').replace(/[^\w-]+/g, '').trim();
}

/**
 * Convert a zero-based index to a Latin letter sequence (a, b, c... aa, ab...).
 * @param n - Zero-based index.
 * @returns Corresponding Latin letter sequence.
 */
export function toLatin(n: number): string {
	let s = '';
	let num = n;
	do {
		s = String.fromCharCode(97 + (num % 26)) + s;
		num = Math.floor(num / 26) - 1;
	} while (num >= 0);
	return s;
}

/**
 * Get the sort index for an alphabetical group character.
 * Used to sort references by their group key.
 * @param char - The group character to get the index for.
 * @returns Numeric index for sorting (0-27, with 28 for unknown).
 */
export function alphaIndex(char: string): number {
	const alphabet = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '*'];
	const idx = alphabet.indexOf(char);
	return idx === -1 ? alphabet.length : idx;
}

/**
 * Escape double quotes in a string for use in HTML attributes.
 * @param value - The string to escape.
 * @returns String with double quotes replaced by &quot;.
 */
export function escapeAttr(value: string): string {
	return value.replace(/"/g, '&quot;');
}

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Check if a string contains any CJK (Chinese, Japanese, Korean) characters.
 * @param text - The string to check.
 * @returns True if CJK characters are found, false otherwise.
 */
export function containsCJK(text: string): boolean {
	return CJK_PATTERN.test(text);
}

/**
 * Convert a positive integer into a base-26 alphabetic sequence (a, b, ..., z, aa, ab, ...).
 * Returns the numeric value as a string when `value <= 0`.
 * @param value - The integer value to convert.
 * @param uppercase - Whether to return uppercase letters.
 * @returns The alphabetic representation of `value`.
 */
export function numberToAlpha(value: number, uppercase: boolean): string {
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

/**
 * Convert a positive integer into a Roman numeral string (supports up to 3999).
 * Returns the numeric value as a string when `value <= 0`.
 * @param value - The integer to convert to Roman numerals.
 * @returns The Roman numeral representation of `value`.
 */
export function numberToRoman(value: number): string {
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
export function commonPrefix(a: string, b: string): string {
    const len = Math.min(a.length, b.length);
    let i = 0;
    while (i < len && a.charAt(i) === b.charAt(i)) i++;
    return a.substring(0, i);
}