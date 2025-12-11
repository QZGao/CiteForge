import esbuild from 'esbuild';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const watch = process.argv.includes('--watch');
const debug = process.argv.includes('--debug');
const pkgJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

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
