import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const watch = process.argv.includes('--watch');
const debug = process.argv.includes('--debug');
const pkgJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const outFile = path.join(__dirname, debug ? '.debug' : 'dist', 'bundled.js');

/**
 * esbuild plugin to extract <template> content from .vue files.
 * Exports the template as a default string for runtime compilation.
 */
const vueTemplatePlugin = {
	name: 'vue-template',
	setup(build) {
		build.onLoad({ filter: /\.vue$/ }, async (args) => {
			const text = await fs.promises.readFile(args.path, 'utf8');
			const match = text.match(/<template>([\s\S]*)<\/template>/);
			if (!match) {
				return { errors: [{ text: `No <template> block found in ${args.path}` }] };
			}
			const template = match[1];
			// Escape backticks and backslashes for template literal
			const escaped = template.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
			return {
				contents: `export default \`${escaped}\`;`,
				loader: 'js'
			};
		});
	}
};

const I18N_VIRTUAL_ID = 'virtual:i18n-catalogues';
const i18nDir = path.join(__dirname, 'src', 'i18n');

const i18nCatalogPlugin = {
	name: 'i18n-catalogues',
	setup(build) {
		build.onResolve({ filter: new RegExp(`^${I18N_VIRTUAL_ID}$`) }, () => ({
			path: I18N_VIRTUAL_ID,
			namespace: 'i18n'
		}));

		build.onLoad({ filter: /.*/, namespace: 'i18n' }, async () => {
			const entries = await fs.promises.readdir(i18nDir, { withFileTypes: true });
			const jsonFiles = entries
				.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
				.map((entry) => entry.name)
				.sort();

			const imports = jsonFiles
				.map((file, index) => `import locale${index} from './${file}';`)
				.join('\n');

			const mappings = jsonFiles
				.map((file, index) => {
					const locale = path.basename(file, '.json');
					return `\t${JSON.stringify(locale)}: locale${index}`;
				})
				.join(',\n');

			const contents = `${imports}
const catalogues = {
${mappings}
};

export default catalogues;
`;

			return {
				contents,
				loader: 'ts',
				resolveDir: i18nDir,
				watchFiles: jsonFiles.map((file) => path.join(i18nDir, file)),
				watchDirs: [i18nDir]
			};
		});
	}
};

const createBuildOptions = () => {
	const timestamp = new Date().toISOString();
	return {
		entryPoints: [path.join(__dirname, 'src', 'main.ts')],
		outfile: outFile,
		bundle: true,
		external: ['vue', '@wikimedia/codex'],
		format: 'iife',
		charset: 'utf8',
		target: ['es2017'],
		minify: !debug,
		sourcemap: debug ? 'inline' : false,
		plugins: [vueTemplatePlugin, i18nCatalogPlugin],
		// Tell esbuild to load CSS files as text so they're bundled into the JS
		loader: {
			'.css': 'text'
		},
		banner: {
			js: `// Cite Forge - Bundled Version
// Maintainer: SuperGrey
// Repository: https://github.com/QZGao/CiteForge
// Release: ${pkgJson.version}
// Timestamp: ${timestamp}
// <nowiki>`
		},
		footer: { js: '// </nowiki>' },
		logLevel: 'info',
	};
};

(async () => {
	try {
		const buildOptions = createBuildOptions();
		if (watch) {
			const ctx = await esbuild.context(buildOptions);
			await ctx.watch();
			console.log('[Cite Forge build] Watching for changes...');
		} else {
			await esbuild.build(buildOptions);
			console.log('[Cite Forge build] Build complete');
		}
	} catch (e) {
		console.error('[Cite Forge build] Build failed:', e);
		process.exit(1);
	}
})();
