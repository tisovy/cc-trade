import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractFile, listPackage, statFile, uncache } from '@electron/asar';
import { assertPackagedApp } from './packaged-app-contract.mjs';

const listRendererFiles = async (root, prefix = '') => {
    const result = [];
    for (const entry of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
        const relative = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) result.push(...await listRendererFiles(root, relative));
        else if (entry.isFile() && !entry.name.endsWith('.map')
            && entry.name !== '.env' && !entry.name.startsWith('.env.')) result.push(relative);
        else if (!entry.isFile()) throw new Error(`Unexpected renderer build entry: ${relative}`);
    }
    return result;
};

export const checkPackagedApp = async (archivePath, rendererDirectory) => {
    // The packager may have read an earlier archive at the same output path.
    uncache(archivePath);
    const files = listPackage(archivePath).map(file => file.replace(/^[/\\]+/, '')).filter(file => {
        const entry = statFile(archivePath, file, false);
        return !('files' in entry);
    });
    const result = assertPackagedApp({
        files,
        readFile: file => extractFile(archivePath, file).toString('utf8'),
        rendererFiles: rendererDirectory ? await listRendererFiles(rendererDirectory) : [],
    });
    console.log(`Packaged application contract passed (${result.files} files, ${result.rendererFiles} renderer build files)`);
    return result;
};

// electron-builder calls this after ASAR creation on every distribution target.
export default async context => checkPackagedApp(
    path.join(context.packager.getResourcesDir(context.appOutDir), 'app.asar'),
    path.join(context.packager.projectDir, 'dist'),
);

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const archivePath = process.argv[2];
    if (!archivePath || process.argv.length > 3) {
        throw new Error('Usage: npm run check:packaged-app -- /absolute/path/to/app.asar');
    }
    await checkPackagedApp(path.resolve(archivePath));
}
