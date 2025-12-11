import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const watch = process.argv.includes('--watch');
const debug = process.argv.includes('--debug');
const pkgJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

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

const createBuildOptions = () => {
    const timestamp = new Date().toISOString();
    return {
        entryPoints: [path.join(__dirname, 'src', 'main.ts')],
        outfile: path.join(__dirname, 'dist', 'bundled.js'),
        bundle: true,
        external: ['vue', '@wikimedia/codex'],
        format: 'iife',
        charset: 'utf8',
        target: ['es2017'],
        minify: false,
        sourcemap: debug ? 'inline' : false,
        plugins: [vueTemplatePlugin],
        // Tell esbuild to load CSS files as text so they're bundled into the JS
        loader: {
            '.css': 'text'
        },
        banner: {
            js: `// Cite Hub - Bundled Version
// Maintainer: SuperGrey
// Repository: https://github.com/QZGao/CiteHub
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
            console.log('[Cite Hub build] Watching for changes...');
        } else {
            await esbuild.build(buildOptions);
            console.log('[Cite Hub build] Build complete');
        }
    } catch (e) {
        console.error('[Cite Hub build] Build failed:', e);
        process.exit(1);
    }
})();
