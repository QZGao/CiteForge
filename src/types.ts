export interface ReferenceUse {
	index: number;
	anchor: Element | null;
}

export interface Reference {
	id: string;
	name: string | null;
	group: string | null;
	contentWikitext: string;
	uses: ReferenceUse[];
}
