import { Reference } from '../types';
import { ensureMount, ensureStyleElement, loadCodexAndVue, registerCodexComponents } from './codex';
import { escapeAttr } from '../core/string_utils';
import { MessageKey, MessageParams, t } from '../i18n';
import styles from './extract_citations.css';
import TEMPLATE from './extract_citations.template.vue';

type VueModule = { createMwApp: (options: unknown) => VueApp };
type VueApp = { mount: (selector: string) => unknown; component?: (name: string, value: unknown) => VueApp };

type ExtractCitationsState = {
	open: boolean;
	refs: Reference[];
	inputText: string;
	outputText: string;
	dialogName: string;
};

type ExtractCitationsRoot = {
	setRefs: (nextRefs: Reference[]) => void;
	openDialog: () => void;
};

const DIALOG_NAME = 'extract_citations';
const STYLE_ID = 'citeforge-extract-citations-styles';
const MOUNT_ID = `citeforge-${DIALOG_NAME}-mount`;

let mountedApp: VueApp | null = null;
let mountedRoot: unknown = null;

/**
 * Type guard to check if a value is an ExtractCitationsRoot.
 * @param val - Value to check.
 * @returns True if the value is an ExtractCitationsRoot, false otherwise.
 */
function isExtractCitationsRoot(val: unknown): val is ExtractCitationsRoot {
	return Boolean(val && typeof (val as ExtractCitationsRoot).setRefs === 'function' && typeof (val as ExtractCitationsRoot).openDialog === 'function');
}

/**
 * Build a reference wrapper string from a Reference object.
 * @param ref - Reference object.
 * @returns The constructed reference wrapper string.
 */
function buildRefWrapper(ref: Reference): string {
	const nameAttr = ref.name ? ` name="${escapeAttr(ref.name)}"` : '';
	const groupAttr = ref.group ? ` group="${escapeAttr(ref.group)}"` : '';
	const content = (ref.contentWikitext || '').trim();
	return content ? `<ref${nameAttr}${groupAttr}>${content}</ref>` : `<ref${nameAttr}${groupAttr} />`;
}

/**
 * Parse input text into an array of trimmed, non-empty lines.
 * @param inputText - Raw input text.
 * @returns Array of parsed lines.
 */
function parseInputLines(inputText: string): string[] {
	return (inputText || '')
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * Find references by name or ID.
 * @param refs - Array of references to search within.
 * @param key - Name or ID to search for.
 * @returns Array of matching Reference objects.
 */
function findRefsByKey(refs: Reference[], key: string): Reference[] {
	const byName = refs.filter((ref) => (ref.name || '') === key);
	if (byName.length) return byName;
	const byId = refs.find((ref) => ref.id === key);
	return byId ? [byId] : [];
}

/**
 * Build output wikitext from input text and references.
 * @param refs - Array of references to search within.
 * @param inputText - Raw input text containing citation names/IDs.
 * @returns Constructed output wikitext.
 */
function buildOutputFromInput(refs: Reference[], inputText: string): string {
	const lines = parseInputLines(inputText);
	if (!lines.length) return '';
	const output: string[] = [];
	lines.forEach((line) => {
		const matches = findRefsByKey(refs, line);
		matches.forEach((ref) => {
			output.push(buildRefWrapper(ref));
		});
	});
	return output.join('\n');
}

/**
 * Open the extract citations dialog, reusing an existing instance when possible.
 * @param refs - Array of references to search within.
 */
export async function openExtractCitationsDialog(refs: Reference[]): Promise<void> {
	ensureStyleElement(STYLE_ID, styles);
	ensureMount(MOUNT_ID);

	if (mountedApp && isExtractCitationsRoot(mountedRoot)) {
		mountedRoot.setRefs(refs);
		mountedRoot.openDialog();
		return;
	}

	const { Vue, Codex } = await loadCodexAndVue();

	const appOptions = {
		data(): ExtractCitationsState {
			return {
				open: true,
				refs,
				inputText: '',
				outputText: '',
				dialogName: DIALOG_NAME
			};
		},
		methods: {
			openDialog(this: ExtractCitationsState): void {
				this.open = true;
			},
			closeDialog(this: ExtractCitationsState): void {
				this.open = false;
			},
			setRefs(this: ExtractCitationsState, nextRefs: Reference[]): void {
				this.refs = nextRefs;
			},
			onInput(this: ExtractCitationsState, value: string): void {
				this.inputText = value;
			},
			extract(this: ExtractCitationsState): void {
				this.outputText = buildOutputFromInput(this.refs, this.inputText);
			},
			t(this: ExtractCitationsState, key: MessageKey, params?: MessageParams): string {
				return t(key, params);
			}
		},
		template: TEMPLATE
	};

	const app = (Vue as VueModule).createMwApp(appOptions);
	registerCodexComponents(app, Codex);
	mountedApp = app;
	mountedRoot = app.mount(`#${MOUNT_ID}`);
	console.info('[Cite Forge] Dialog opened', { name: DIALOG_NAME });
}
