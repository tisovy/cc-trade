import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SOURCE_ROOTS = ['electron', 'src'];
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];
const IMPORT_PATTERN = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?|\bimport\s*\()\s*['"]([^'"]+)['"]/g;

const walk = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name.startsWith('dist')) continue;
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...await walk(absolute));
        else if (SOURCE_EXTENSIONS.includes(path.extname(entry.name))) files.push(absolute);
    }
    return files;
};

const resolveImport = async (source, specifier) => {
    if (!specifier.startsWith('.')) return null;
    const base = path.resolve(path.dirname(source), specifier);
    const candidates = [
        base,
        ...SOURCE_EXTENSIONS.map(extension => `${base}${extension}`),
        ...SOURCE_EXTENSIONS.map(extension => path.join(base, `index${extension}`)),
    ];
    for (const candidate of candidates) {
        try {
            if ((await fs.stat(candidate)).isFile()) return candidate;
        } catch {
            // Continue through the bounded local-resolution candidates.
        }
    }
    return null;
};

const files = (await Promise.all(SOURCE_ROOTS.map(root => walk(path.join(ROOT, root))))).flat();
const fileSet = new Set(files);
const graph = new Map();

for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    const dependencies = new Set();
    for (const match of source.matchAll(IMPORT_PATTERN)) {
        const resolved = await resolveImport(file, match[1]);
        if (resolved && fileSet.has(resolved)) dependencies.add(resolved);
    }
    graph.set(file, dependencies);
}

const visiting = new Set();
const visited = new Set();
const stack = [];
const cycles = new Set();

const visit = (file) => {
    if (visited.has(file)) return;
    if (visiting.has(file)) {
        const start = stack.indexOf(file);
        const cycle = [...stack.slice(start), file]
            .map(entry => path.relative(ROOT, entry))
            .join(' -> ');
        cycles.add(cycle);
        return;
    }
    visiting.add(file);
    stack.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
};

for (const file of files) visit(file);

if (cycles.size > 0) {
    console.error('Circular imports detected:');
    for (const cycle of [...cycles].sort()) console.error(`  ${cycle}`);
    process.exitCode = 1;
} else {
    console.log(`Circular-import check passed (${files.length} source files).`);
}
