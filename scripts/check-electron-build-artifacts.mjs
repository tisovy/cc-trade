import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd());
const outputDirectory = path.join(root, 'dist-electron');
const expectedArtifacts = new Set(['main.js', 'preload.cjs']);
const retiredImplementationSignatures = Object.freeze([
    'futuresReadEnvironment',
    'FUTURES_READ_CHANNEL_ID',
    'FUTURES_TESTNET_EXECUTION_ACTION',
    'FUTURES_TESTNET_WORKSTATION_CHANNEL_ID',
    'reviewed-testnet-public-read',
]);

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
        console.log('Electron build artifact boundary skipped (no build output)');
        process.exit(0);
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
const leakedSignatures = retiredImplementationSignatures.filter(signature => (
    mainSource.includes(signature) || preloadSource.includes(signature)
));
if (leakedSignatures.length > 0) {
    throw new Error(`Retired Futures implementation leaked into Electron build: ${leakedSignatures.join(', ')}`);
}

console.log(`Electron build artifact boundary passed (${files.length} files)`);
