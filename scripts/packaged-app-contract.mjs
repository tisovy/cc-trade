import path from 'node:path';
import { assertNormalElectronBuildSources } from './electron-build-artifact-contract.mjs';

const normalizeArchivePath = value => value.replaceAll('\\', '/').replace(/^\/+/, '');

/** Inspect first-party files, without executing anything from the archive. */
export const assertPackagedApp = ({ files, readFile, rendererFiles = [] }) => {
    const paths = new Set(files.map(normalizeArchivePath));
    const requireFile = file => {
        if (!paths.has(file)) throw new Error(`Packaged application is missing ${file}`);
    };
    for (const file of ['package.json', 'dist/index.html', 'dist-electron/main.js', 'dist-electron/preload.cjs']) {
        requireFile(file);
    }
    for (const file of paths) {
        if (file.split('/').some(part => part === '.env' || part.startsWith('.env.'))) {
            throw new Error(`Environment file leaked into package: ${file}`);
        }
        // Production dependencies are selected by electron-builder, not a
        // hand-maintained list here. First-party sources must be built outputs.
        if (file.startsWith('node_modules/')) continue;
        if (file !== 'package.json' && file !== 'dist-electron/main.js'
            && file !== 'dist-electron/preload.cjs' && !file.startsWith('dist/')) {
            throw new Error(`Unexpected first-party file in package: ${file}`);
        }
        if (file.endsWith('.map') || /\.(?:test|spec)\.[^/]+$/.test(file)) {
            throw new Error(`Development artifact leaked into package: ${file}`);
        }
    }
    const manifest = JSON.parse(readFile('package.json'));
    if (manifest.main !== 'dist-electron/main.js' || manifest.type !== 'module') {
        throw new Error('Packaged manifest does not launch the production ES module main');
    }
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        requireFile(`node_modules/${dependency}/package.json`);
    }
    assertNormalElectronBuildSources({
        mainSource: readFile('dist-electron/main.js'),
        preloadSource: readFile('dist-electron/preload.cjs'),
    });
    // The hook also supplies the whole renderer build inventory, including
    // lazy-loaded chunks that are not named directly by index.html.
    for (const file of rendererFiles) requireFile(`dist/${normalizeArchivePath(file)}`);
    const html = readFile('dist/index.html');
    let localScriptCount = 0;
    for (const match of html.matchAll(/\b(src|href)\s*=\s*["']([^"']+)["']/g)) {
        const reference = match[2].split(/[?#]/)[0];
        if (!reference || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) continue;
        const resolved = path.posix.normalize(`dist/${decodeURIComponent(reference).replace(/^\/+/, '')}`);
        if (!resolved.startsWith('dist/')) throw new Error(`Renderer reference escapes dist: ${reference}`);
        requireFile(resolved);
        if (match[1] === 'src' && /\.m?js$/.test(resolved)) localScriptCount += 1;
    }
    if (localScriptCount === 0) throw new Error('Packaged renderer has no local script entry');
    return { files: paths.size, rendererFiles: rendererFiles.length };
};
