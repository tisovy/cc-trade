// One reachable trading-submission path in the renderer.
//
// `src/utils/operations.js` used to carry a second one: a legacy `buysell` that
// composed untyped `buyOrder`/`sellOrder` frames, carried no command identity,
// was subject to no risk ceiling, and refused orders on a local copy of the
// exchange's price band. It had lost every caller, so nothing failed — it just
// sat there reading as an available way to place an order.
//
// This check keeps the property rather than the deletion: no renderer module
// outside the typed command builders may compose a trading frame.

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const RENDERER_ROOT = 'src';
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs'];

// The one module allowed to name a trading action or a trading request: every
// frame the renderer sends is built here.
export const COMMAND_BUILDER_MODULE = 'src/utils/tradingCommands.js';

// Legacy untyped frames the retired path used. `notifyDialog` is included
// because it travelled the same way and had the same absence of validation.
export const FORBIDDEN_REQUEST_VALUES = Object.freeze([
    'buyOrder',
    'sellOrder',
    'cancelOrder',
    'notifyDialog',
]);

// Typed actions. Anything under these prefixes mutates or reads the account and
// belongs in the builders.
export const FORBIDDEN_ACTION_PREFIXES = Object.freeze(['trade.', 'account.']);

const requestPattern = () => new RegExp(
    `\\brequest\\s*:\\s*['"\`](${FORBIDDEN_REQUEST_VALUES.join('|')})['"\`]`,
    'g',
);
const actionPattern = () => new RegExp(
    `\\baction\\s*:\\s*['"\`](${FORBIDDEN_ACTION_PREFIXES.map(p => `${p.replace('.', '\\.')}[A-Za-z]`).join('|')})`,
    'g',
);

// Comments describe; they do not send. A commented-out frame is documentation
// of what was removed, not a path back to it.
const stripComments = source => source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(line => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');

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

export const analyzeRendererCommandPath = async ({
    root = ROOT,
    rendererRoot = RENDERER_ROOT,
    builderModule = COMMAND_BUILDER_MODULE,
} = {}) => {
    const files = (await walk(path.join(root, rendererRoot)))
        .filter(file => !/\.test\.[jt]sx?$/.test(file));
    const violations = [];

    for (const file of files) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        if (relative === builderModule) continue;
        const source = stripComments(await fs.readFile(file, 'utf8'));
        for (const pattern of [requestPattern(), actionPattern()]) {
            for (const match of source.matchAll(pattern)) {
                const line = source.slice(0, match.index).split('\n').length;
                violations.push({ file: relative, line, snippet: match[0] });
            }
        }
    }

    return { files, violations };
};

export const runRendererCommandPathCheck = async (options = {}) => {
    const { files, violations } = await analyzeRendererCommandPath(options);
    if (violations.length > 0) {
        console.error('Trading frames composed outside the typed command builders:');
        for (const violation of violations) {
            console.error(`  ${violation.file}:${violation.line} — ${violation.snippet}`);
        }
        console.error(`Build the frame in ${options.builderModule ?? COMMAND_BUILDER_MODULE} instead.`);
        return false;
    }
    console.log(
        `Renderer trading-command path check passed (${files.length} modules scanned; one builder).`,
    );
    return true;
};

if (import.meta.url === `file://${process.argv[1]}`) {
    process.exitCode = await runRendererCommandPathCheck() ? 0 : 1;
}
