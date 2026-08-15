// Inspects the **built artifacts** in `dist-electron`. Its counterpart,
// `check-runtime-mock-layer.mjs`, inspects the production **source graph**.
// Neither subsumes the other: source can be clean while a build pulls in a
// verification composition, and a build can be clean while source drifts.

import fs from 'node:fs/promises';
import path from 'node:path';
import { assertNormalElectronBuildSources } from './electron-build-artifact-contract.mjs';

const root = path.resolve(process.cwd());
const outputDirectory = path.join(root, 'dist-electron');
const expectedArtifacts = new Set(['main.js', 'preload.cjs']);
if (process.argv[2] !== undefined) {
    throw new Error('Electron build artifact check does not accept a build mode');
}

const files = [];
const visit = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile()) files.push(path.relative(outputDirectory, absolute));
        else throw new Error(`Unexpected Electron build entry: ${absolute}`);
    }
};

try {
    const status = await fs.lstat(outputDirectory);
    if (status.isSymbolicLink() || !status.isDirectory()) {
        throw new Error('Electron build output must be a real directory');
    }
} catch (error) {
    if (error?.code === 'ENOENT') {
        throw new Error('Electron build output is missing; run the normal build first');
    }
    throw error;
}

await visit(outputDirectory);
const unexpectedArtifacts = files.filter(file => !expectedArtifacts.has(file));
if (unexpectedArtifacts.length > 0) {
    throw new Error(`Unexpected Electron build artifacts: ${unexpectedArtifacts.join(', ')}`);
}
for (const required of expectedArtifacts) {
    if (!files.includes(required)) {
        throw new Error(`Missing required Electron build artifact: ${required}`);
    }
}

const mainSource = await fs.readFile(path.join(outputDirectory, 'main.js'), 'utf8');
const preloadSource = await fs.readFile(path.join(outputDirectory, 'preload.cjs'), 'utf8');
assertNormalElectronBuildSources({ mainSource, preloadSource });

console.log(`Electron build artifact boundary passed (${files.length} files)`);
