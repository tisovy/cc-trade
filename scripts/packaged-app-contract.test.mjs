// @vitest-environment node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackage } from '@electron/asar';
import { getMainFileMatchers } from 'app-builder-lib/out/fileMatcher.js';
import { afterEach, describe, expect, it } from 'vitest';
import { assertPackagedApp } from './packaged-app-contract.mjs';
import afterPack, { checkPackagedApp } from './check-packaged-app.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const manifest = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8'));
const main = 'mode: reviewed-public-read\nkind: reviewed-production-public-read';
const runtime = () => ({
    'package.json': JSON.stringify({ main: 'dist-electron/main.js', type: 'module', dependencies: { ws: '*' } }),
    'dist-electron/main.js': main,
    'dist-electron/preload.cjs': 'bounded preload',
    'dist/index.html': '<script type="module" src="./assets/index.js"></script><link href="./assets/index.css" rel="stylesheet">',
    'dist/assets/index.js': 'import("./SpotWorkspace.js")',
    'dist/assets/index.css': 'body {}',
    'dist/assets/SpotWorkspace.js': 'export default null',
    'node_modules/ws/package.json': '{"name":"ws"}',
});
const inspect = (entries, rendererFiles) => assertPackagedApp({
    files: Object.keys(entries), readFile: file => entries[file], rendererFiles,
});
const temporaryDirectories = [];
afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

describe('electron-builder file selection', () => {
    const packager = { info: {
        projectDir: projectRoot,
        buildResourcesDir: 'build',
        config: manifest.build,
        isPrepackedAppAsar: false,
        debugLogger: { isEnabled: false },
    } };
    const matchers = getMainFileMatchers(
        projectRoot, '/package-destination', value => value, {}, packager,
        path.join(projectRoot, manifest.build.directories.output), false,
    );
    const filter = matchers[0].createFilter();
    const included = relative => filter(path.join(projectRoot, relative), { isDirectory: () => false });

    it('separates installer output from the renderer and retains the real archive hook', () => {
        expect(manifest.build.directories.output).toBe('release');
        expect(manifest.build.asar).toBe(true);
        expect(manifest.build.afterPack).toBe('./scripts/check-packaged-app.mjs');
        expect(manifest.scripts.predist).toBe('npm run build');
        expect(manifest.scripts.dist).toBe('electron-builder');
    });

    it.each(['dist/index.html', 'dist/assets/index.js', 'dist/assets/lazy.js', 'dist/vite.svg',
        'dist-electron/main.js', 'dist-electron/preload.cjs', 'package.json'])('includes %s', file => {
        expect(included(file)).toBe(true);
    });

    it.each(['.env', '.env.local', '.env.example', 'dist/.env', 'dist/assets/.env.production',
        'dist/assets/index.js.map', 'src/main.jsx', 'openspec/config.yaml', 'archive/futures-testnet/README.md',
        'logs/trading.log', 'electron/main.js', 'dist-electron/main.safe-dev.js', 'scripts/check-packaged-app.mjs',
        'release/linux-unpacked/resources/app.asar'])('excludes %s', file => {
        expect(included(file)).toBe(false);
    });
});

describe('packaged application archive contract', () => {
    it('accepts the runtime and the complete renderer build inventory', () => {
        expect(inspect(runtime(), ['index.html', 'assets/index.js', 'assets/index.css', 'assets/SpotWorkspace.js']))
            .toMatchObject({ files: 8, rendererFiles: 4 });
    });

    it.each(['dist/index.html', 'dist-electron/main.js', 'dist-electron/preload.cjs',
        'dist/assets/index.js', 'dist/assets/index.css', 'node_modules/ws/package.json'])('rejects missing %s', file => {
        const entries = runtime();
        delete entries[file];
        expect(() => inspect(entries)).toThrow(file);
    });

    it('requires lazy chunks from the build inventory too', () => {
        const entries = runtime();
        delete entries['dist/assets/SpotWorkspace.js'];
        expect(() => inspect(entries, ['assets/SpotWorkspace.js'])).toThrow('dist/assets/SpotWorkspace.js');
    });

    it.each(['.env', 'dist/.env.local', 'node_modules/example/.env', 'openspec/config.yaml',
        'archive/futures-testnet/README.md', 'src/main.jsx', 'dist/assets/index.js.map',
        'dist/assets/chart.test.js', 'dist-electron/main.safe-dev.js'])('rejects leaked %s', file => {
        expect(() => inspect({ ...runtime(), [file]: 'unwanted' })).toThrow(/leaked|Unexpected/);
    });

    it('rejects a verification-only main and an invalid manifest', () => {
        expect(() => inspect({ ...runtime(), 'dist-electron/main.js': `${main}\nmode: deterministic-fake` }))
            .toThrow('verification-only Futures implementation leaked');
        expect(() => inspect({ ...runtime(), 'package.json': '{"main":"electron/main.js"}' }))
            .toThrow('Packaged manifest');
    });

    it('does not accept an empty renderer or an escaping local reference', () => {
        expect(() => inspect({ ...runtime(), 'dist/index.html': '<html></html>' })).toThrow('no local script');
        expect(() => inspect({ ...runtime(), 'dist/index.html': '<script src="../secret.js"></script>' }))
            .toThrow('escapes dist');
    });

    it('reads a real ASAR through the same hook the packager invokes', async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cc-trade-package-contract-'));
        temporaryDirectories.push(directory);
        const source = path.join(directory, 'source');
        const resources = path.join(directory, 'resources');
        for (const [file, content] of Object.entries(runtime())) {
            const destination = path.join(source, file);
            await fs.mkdir(path.dirname(destination), { recursive: true });
            await fs.writeFile(destination, content);
        }
        await fs.mkdir(resources);
        const archive = path.join(resources, 'app.asar');
        await createPackage(source, archive);
        await expect(checkPackagedApp(archive)).resolves.toMatchObject({ files: 8 });
        await expect(afterPack({
            appOutDir: directory,
            packager: { getResourcesDir: () => resources, projectDir: source },
        })).resolves.toMatchObject({ files: 8, rendererFiles: 4 });
    });
});
