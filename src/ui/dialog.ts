import { loadCodex } from './codex';

type VueModule = {
	createMwApp: (options: unknown) => VueApp;
};

type VueApp = {
	mount: (selector: string) => unknown;
	component?: (name: string, value: unknown) => VueApp;
};

type CodexModule = Partial<{
	CdxDialog: unknown;
	CdxButton: unknown;
	CdxSelect: unknown;
	CdxTextInput: unknown;
}>;

let mountedApp: VueApp | null = null;
let mountedRoot: unknown = null;
const MOUNT_ID = 'citehub-dialog-mount';

export async function loadCodexAndVue(): Promise<{ Vue: VueModule; Codex: CodexModule }> {
	const loaded = await loadCodex();
	return loaded as { Vue: VueModule; Codex: CodexModule };
}

export function createDialogMountIfNeeded(): HTMLElement {
	let mount = document.getElementById(MOUNT_ID);
	if (!mount) {
		mount = document.createElement('div');
		mount.id = MOUNT_ID;
		document.body.appendChild(mount);
	}
	return mount;
}

export function mountApp(app: VueApp): VueApp {
	createDialogMountIfNeeded();
	mountedApp = app;
	mountedRoot = mountedApp.mount(`#${MOUNT_ID}`);
	return mountedApp;
}

export function getMountedApp(): VueApp | null {
	return mountedApp;
}

export function getMountedRoot(): unknown {
	return mountedRoot;
}

export function removeDialogMount(): void {
	const mount = document.getElementById(MOUNT_ID);
	if (mount) {
		mount.remove();
	}
	mountedApp = null;
	mountedRoot = null;
}

export function registerCodexComponents(app: VueApp, Codex: CodexModule): void {
	if (!app || !app.component || !Codex) return;
	try {
		if (Codex.CdxDialog) app.component('cdx-dialog', Codex.CdxDialog);
		if (Codex.CdxButton) app.component('cdx-button', Codex.CdxButton);
		if (Codex.CdxSelect) app.component('cdx-select', Codex.CdxSelect);
		if (Codex.CdxTextInput) app.component('cdx-text-input', Codex.CdxTextInput);
	} catch {
		// best effort; ignore registration errors
	}
}
