// global.d.ts at package root - allow importing CSS and Vue template files as strings
declare module '*.css' {
	const content: string;
	export default content;
}

declare module '*.vue' {
	const template: string;
	export default template;
}

declare module '@vue/runtime-core' {
	interface ComponentCustomProperties {
		config: any; // or a real type, e.g. Record<string, unknown>
	}
}

declare module 'virtual:i18n-catalogues' {
	const catalogues: Record<string, Record<string, string>>;
	export default catalogues;
}
