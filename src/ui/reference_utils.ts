/**
 * Get the alphabetical grouping key for a reference name.
 * Returns '#' for numeric, '*' for unnamed/special, or uppercase letter.
 * @param name - The reference name to categorize.
 * @returns Single character representing the group.
 */
export function groupKey(name: string | null | undefined): string {
	if (!name) return '*';
	const first = name.trim().charAt(0);
	if (!first) return '*';
	if (/[0-9]/.test(first)) return '#';
	if (/[a-z]/i.test(first)) return first.toUpperCase();
	return '*';
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

/**
 * Format a reference name for copying based on user preference.
 * @param name - The reference name to format.
 * @param fmt - The format style: 'raw', 'r' (template), or 'ref' (tag).
 * @returns Formatted string ready for clipboard.
 */
export function formatCopy(name: string, fmt: 'raw' | 'r' | 'ref'): string {
	if (fmt === 'r') return `{{r|${name}}}`;
	if (fmt === 'ref') return `<ref name="${escapeAttr(name)}" />`;
	return name;
}
