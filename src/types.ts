/**
 * Represents a single usage of a reference in the document.
 */
export interface ReferenceUse {
	/** Zero-based index of this use among all uses of the parent reference. */
	index: number;
	/** DOM element (typically an anchor) corresponding to this use, if found. */
	anchor: Element | null;
}

/**
 * Represents a citation reference extracted from wikitext.
 */
export interface Reference {
	/** Unique identifier for the reference (name or generated key). */
	id: string;
	/** The `name` attribute of the ref tag, or null if unnamed. */
	name: string | null;
	/** The `group` attribute of the ref tag, or null if not grouped. */
	group: string | null;
	/** The wikitext content inside the ref tag. */
	contentWikitext: string;
	/** All uses (invocations) of this reference in the document. */
	uses: ReferenceUse[];
}
