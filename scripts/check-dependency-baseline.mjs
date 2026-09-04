import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Reviewed 2026-09-04. These are regression floors, not a vulnerability feed.
// A new major needs compatibility/security review before changing this table.
export const DEPENDENCY_BASELINE = Object.freeze({
    electron: '43.6.0',
    'electron-builder': '26.15.3',
    ws: '8.21.3',
    vite: '7.3.6',
    vitest: '4.1.11',
    axios: '1.20.0',
    tar: '7.5.19',
});

const parseStableVersion = version => {
    if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) return null;
    const parts = version.split('.').map(Number);
    return parts.every(Number.isSafeInteger) ? parts : null;
};

export const assertDependencyBaseline = (lockfile) => {
    if (lockfile?.lockfileVersion !== 3 || !lockfile.packages || typeof lockfile.packages !== 'object'
        || Array.isArray(lockfile.packages)) throw new Error('Expected npm lockfile v3 packages');
    const inventory = [];
    const violations = [];
    for (const [name, floor] of Object.entries(DEPENDENCY_BASELINE)) {
        const minimum = parseStableVersion(floor);
        const suffix = `node_modules/${name}`;
        const copies = Object.entries(lockfile.packages).filter(([location]) => location === suffix
            || location.endsWith(`/${suffix}`));
        if (copies.length === 0) violations.push(`Missing reviewed dependency: ${name}`);
        for (const [location, entry] of copies) {
            const version = parseStableVersion(entry?.version);
            const acceptable = version && version[0] === minimum[0]
                && (version[1] > minimum[1] || (version[1] === minimum[1] && version[2] >= minimum[2]));
            if (!acceptable || entry.link) violations.push(`${location}: expected stable ${floor} or later in major ${minimum[0]}`);
            inventory.push({ name, location, version: entry?.version });
        }
    }
    if (violations.length) throw new Error(`Dependency baseline failed:\n${violations.join('\n')}`);
    return inventory;
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    // Resolve from the script, never from an arbitrary invocation directory.
    const lockPath = fileURLToPath(new URL('../package-lock.json', import.meta.url));
    const inventory = assertDependencyBaseline(JSON.parse(fs.readFileSync(lockPath, 'utf8')));
    console.log(`Local dependency baseline passed (${inventory.length} locked copies; not a vulnerability scan)`);
}
