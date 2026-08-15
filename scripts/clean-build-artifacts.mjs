import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd());
const buildDirectories = Object.freeze(['dist', 'dist-electron']);

for (const directory of buildDirectories) {
    const target = path.resolve(root, directory);
    if (path.dirname(target) !== root) {
        throw new Error(`Refusing to clean build path outside repository root: ${target}`);
    }
    try {
        const status = await fs.lstat(target);
        if (status.isSymbolicLink()) {
            throw new Error(`Refusing to clean symlinked build path: ${target}`);
        }
        if (!status.isDirectory()) {
            throw new Error(`Refusing to clean non-directory build path: ${target}`);
        }
        await fs.rm(target, { recursive: true, force: false });
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

console.log('Build artifact directories cleaned');
