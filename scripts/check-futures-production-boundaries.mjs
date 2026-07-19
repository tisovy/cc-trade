import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const failures = [];

const FUTURES_PRODUCTION_FACADE = (
    'electron/services/futures-production-execution-facade.js'
);
const FUTURES_PRODUCTION_CONFIG = (
    'electron/services/futures-production-execution-config.js'
);
const FUTURES_PRODUCTION_COMPOSITION = (
    'electron/services/futures-production-execution-composition.js'
);
const REVIEWED_PRODUCTION_ORIGIN = 'https://fapi.binance.com';
const REVIEWED_PRODUCTION_WS_ORIGIN = 'wss://fstream.binance.com';
const REVIEWED_PRODUCTION_HOST = 'fapi.binance.com';
const REVIEWED_PRODUCTION_WS_HOST = 'fstream.binance.com';
const REVIEWED_PRODUCTION_ROUTES = Object.freeze(new Set([
    '/fapi/v1/time',
    '/fapi/v1/exchangeInfo',
    '/fapi/v1/premiumIndex',
    '/fapi/v1/accountConfig',
    '/fapi/v1/symbolConfig',
    '/fapi/v3/balance',
    '/fapi/v3/positionRisk',
    '/fapi/v1/openOrders',
    '/fapi/v1/listenKey',
    '/fapi/v1/openAlgoOrders',
    '/fapi/v1/order',
    '/fapi/v1/positionMargin',
    '/fapi/v1/positionMargin/history',
    '/fapi/v1/allOpenOrders',
    '/fapi/v1/algoOpenOrders',
]));
const ALTERNATE_TRANSPORT_MODULES = Object.freeze(new Set([
    'http',
    'https',
    'http2',
    'tls',
    'net',
    'dgram',
    'dns',
    'ws',
    'undici',
    'node-fetch',
    'cross-fetch',
    'axios',
    'got',
    'superagent',
]));

const fail = message => failures.push(message);
const relative = absolute => path.relative(ROOT, absolute).split(path.sep).join('/');

const readModuleSpecifiers = (source) => {
    const specifiers = [];
    const pattern = (
        /\b(?:from|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm
    );
    for (const match of source.matchAll(pattern)) specifiers.push(match[1] ?? match[2]);
    return specifiers;
};

const isAlternateTransportModule = (specifier) => {
    const normalized = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    const topLevel = normalized.startsWith('@')
        ? normalized.split('/').slice(0, 2).join('/')
        : normalized.split('/')[0];
    return ALTERNATE_TRANSPORT_MODULES.has(topLevel);
};

const resolveLocalModule = (fromFile, specifier, knownFiles) => {
    if (!specifier.startsWith('.')) return null;
    const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
    const base = path.resolve(path.dirname(fromFile), cleanSpecifier);
    const candidates = [
        base,
        ...['.js', '.cjs', '.mjs', '.jsx'].map(extension => `${base}${extension}`),
        ...['.js', '.cjs', '.mjs', '.jsx'].map(extension => path.join(base, `index${extension}`)),
    ];
    return candidates.find(candidate => knownFiles.has(candidate)) ?? null;
};

const collectLocalImportClosure = (entries, knownFiles) => {
    const closure = new Set();
    const pending = [...entries];
    while (pending.length > 0) {
        const file = pending.pop();
        if (closure.has(file)) continue;
        closure.add(file);
        const source = fs.readFileSync(file, 'utf8');
        for (const specifier of readModuleSpecifiers(source)) {
            const dependency = resolveLocalModule(file, specifier, knownFiles);
            if (dependency !== null && !closure.has(dependency)) pending.push(dependency);
        }
    }
    return [...closure];
};

const walk = (directory) => {
    if (!fs.existsSync(directory)) return [];
    const output = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('dist')) {
            continue;
        }
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) output.push(...walk(absolute));
        else output.push(absolute);
    }
    return output;
};

const sourceFiles = [
    ...walk(path.join(ROOT, 'electron')),
    ...walk(path.join(ROOT, 'src')),
].filter(file => /\.(?:c?js|mjs|jsx)$/.test(file));
const implementationSourceFiles = sourceFiles.filter(file => !/\.test\.[^.]+$/.test(file));
const PHASE8_LOCAL_WORKSTATION_CONNECTOR = 'src/hooks/useFuturesLocalWorkstationConnection.js';
const implementationSourceSet = new Set(implementationSourceFiles);
const namedProductionImplementationFiles = implementationSourceFiles.filter(file => (
    /futures-production|FuturesProduction/.test(file)
));
const productionImplementationFiles = collectLocalImportClosure(
    namedProductionImplementationFiles,
    implementationSourceSet,
);
const productionExecutionImplementationFiles = collectLocalImportClosure(
    namedProductionImplementationFiles.filter(file => (
        /futures-production-execution|FuturesProductionExecution/.test(file)
    )),
    implementationSourceSet,
);
const reviewedHostLocations = [];

for (const file of productionImplementationFiles) {
    const name = relative(file);
    const source = fs.readFileSync(file, 'utf8');

    for (const specifier of readModuleSpecifiers(source)) {
        if (/(?:futures[-_]?readonly|futures[-_]?testnet[-_]?execution|futuresReadOnly|futuresTestnetExecution|FuturesReadOnly|FuturesTestnetExecution)/.test(specifier)) {
            fail(`${name} imports frozen Phase 5/6 module ${specifier}`);
        }
    }

    if (name !== 'electron/futures-production-network-guard.js'
        && /demo-fapi|demo-fstream|testnet|futures\.execution\.|cc6-/i.test(source)) {
        fail(`${name} contains a Phase 6 host, action, or identity`);
    }
}

for (const file of productionExecutionImplementationFiles) {
    const name = relative(file);
    const source = fs.readFileSync(file, 'utf8');

    for (const specifier of readModuleSpecifiers(source)) {
        if (isAlternateTransportModule(specifier)
            && !(name === FUTURES_PRODUCTION_FACADE && specifier === 'ws')) {
            fail(`${name} imports alternate network transport ${specifier}`);
        }
    }

    if (/import\s*\{[^}]*\bnet\b[^}]*\}\s*from\s*['"]electron['"]/s.test(source)
        || (name !== FUTURES_PRODUCTION_FACADE
            && /\b(?:new\s+)?(?:globalThis\s*\.\s*)?(?:WebSocket|XMLHttpRequest|EventSource)\s*\(/.test(source))
        || /\bnavigator\s*\.\s*sendBeacon\s*\(/.test(source)
        || /\b(?:https?|http2|tls|net)\s*\.\s*(?:request|get|connect|createConnection|createServer)\s*\(/.test(source)) {
        fail(`${name} creates an alternate HTTP, TLS, net, or WebSocket transport`);
    }
    if (name !== FUTURES_PRODUCTION_FACADE
        && (/\b(?:globalThis\s*\.\s*)?fetch\s*\(/.test(source)
            || /\bfetchImpl\s*\(/.test(source))) {
        fail(`${name} dispatches outside the reviewed production facade`);
    }

    for (const match of source.matchAll(/\b(?:https?|wss?):\/\/[^'"`\s)<>\]}]+/gi)) {
        if (![REVIEWED_PRODUCTION_ORIGIN, REVIEWED_PRODUCTION_WS_ORIGIN].includes(match[0])) {
            fail(`${name} contains an unreviewed production origin: ${match[0]}`);
        }
    }
    for (const match of source.matchAll(/\b(?:[a-z0-9-]+\.)+binance\.com\b/gi)) {
        const host = match[0].toLowerCase();
        if (![REVIEWED_PRODUCTION_HOST, REVIEWED_PRODUCTION_WS_HOST].includes(host)) {
            fail(`${name} contains an unreviewed Binance host: ${host}`);
        } else {
            reviewedHostLocations.push(name);
        }
    }
    for (const match of source.matchAll(/\/fapi\/[A-Za-z0-9._/-]+/g)) {
        if (name !== FUTURES_PRODUCTION_FACADE) {
            fail(`${name} contains production route ${match[0]} outside the reviewed facade`);
        } else if (!REVIEWED_PRODUCTION_ROUTES.has(match[0])) {
            fail(`${name} contains unreviewed production route ${match[0]}`);
        }
    }
}

if (reviewedHostLocations.length !== 2
    || reviewedHostLocations.some(location => location !== FUTURES_PRODUCTION_CONFIG)) {
    fail('The exact production REST/WS hosts must appear only in the production config module');
}

const facadePath = path.join(ROOT, FUTURES_PRODUCTION_FACADE);
if (fs.existsSync(facadePath)) {
    const facade = fs.readFileSync(facadePath, 'utf8');
    if (!/redirect\s*:\s*['"]error['"]/.test(facade)) {
        fail('Production facade does not explicitly reject redirects');
    }
    if (!/response\?\.redirected\s*===\s*true/.test(facade)) {
        fail('Production facade does not reject a redirected fake or nonconforming response');
    }
    if (/\b(?:proxy|dispatcher|httpsAgent|httpAgent|agent|socketFactory)\s*:/.test(facade)
        || /['"](?:host|hostname|origin|baseUrl|baseURL|url|protocol|port|proxy|dispatcher|httpsAgent|httpAgent|agent|socketFactory|connect)['"]\s*[,}\]]/.test(facade)) {
        fail('Production facade contains caller/network-agent configuration');
    }
    if (/\b(?:globalThis\s*\.\s*)?fetch\s*\(/.test(facade)
        || [...facade.matchAll(/\bfetchImpl\s*\(/g)].length !== 1) {
        fail('Production facade does not have exactly one injected fetch dispatch point');
    }
    if (!/parsed\.origin\s*!==\s*FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN/.test(facade)
        || !/assertFixedUrl\(url,\s*pathname\)/.test(facade)) {
        fail('Production facade does not pin every request to the reviewed origin');
    }
    for (const endpoint of REVIEWED_PRODUCTION_ROUTES) {
        if (!facade.includes(`'${endpoint}'`) && !facade.includes(`"${endpoint}"`)) {
            fail(`Production facade is missing reviewed route ${endpoint}`);
        }
    }
}

const configPath = path.join(ROOT, FUTURES_PRODUCTION_CONFIG);
if (fs.existsSync(configPath)) {
    const config = fs.readFileSync(configPath, 'utf8');
    if (!/export const FUTURES_PRODUCTION_EXECUTION_REST_ORIGIN\s*=\s*['"]https:\/\/fapi\.binance\.com['"]\s*;/.test(config)) {
        fail('Production config does not declare the exact reviewed HTTPS origin');
    }
    if (!/export const FUTURES_PRODUCTION_EXECUTION_WS_ORIGIN\s*=\s*['"]wss:\/\/fstream\.binance\.com['"]\s*;/.test(config)) {
        fail('Production config does not declare the exact reviewed WSS origin');
    }
    if (/['"]FUTURES_PRODUCTION_(?:EXECUTION_)?LIVE_AUTH(?:ORIZED|ORIZATION)['"]/.test(config)) {
        fail('Production config exposes the compiled live interlock through the environment');
    }
}

const reviewedWritePaths = [
    '/fapi/v1/order',
    '/fapi/v1/positionMargin',
    '/fapi/v1/allOpenOrders',
    '/fapi/v1/algoOpenOrders',
];
for (const file of sourceFiles.filter(file => !/\.test\.[^.]+$/.test(file))) {
    const name = relative(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const endpoint of reviewedWritePaths) {
        if (source.includes(endpoint)
            && name !== 'electron/services/futures-production-execution-facade.js') {
            fail(`${name} contains production write endpoint ${endpoint}`);
        }
    }
}

const rendererProductionFiles = [...new Set([
    ...productionImplementationFiles.filter(file => relative(file).startsWith('src/')),
    ...walk(path.join(ROOT, 'src')).filter(file => (
        /futures-production|FuturesProduction/.test(file)
        && /\.css$/.test(file)
        && !/\.test\.[^.]+$/.test(file)
    )),
])];
const rendererForbiddenPatterns = Object.freeze([
    {
        label: 'credential material',
        pattern: /\b(?:api[-_]?key|api[-_]?secret|recovery[-_]?authorization|credential(?:s|binding)?|authorization|signature|secret)\b/i,
    },
    {
        label: 'environment access',
        pattern: /(?:process|Deno|Bun)\s*\.\s*env\b|import\s*\.\s*meta\s*\.\s*env\b/i,
    },
    {
        label: 'browser storage',
        pattern: /\b(?:localStorage|sessionStorage|indexedDB|cookieStore|CacheStorage|StorageManager)\b|\bdocument\s*\.\s*cookie\b|\bcaches\s*\.\s*open\s*\(/i,
    },
    {
        label: 'clipboard access',
        pattern: /\bclipboard\b/i,
    },
    {
        label: 'analytics, telemetry, or crash reporting',
        pattern: /\b(?:analytics|telemetry|Sentry|Crashlytics|crashReporter|captureException|datadog|mixpanel|segment|amplitude|posthog)\b/i,
    },
    {
        label: 'renderer-owned network transport',
        pattern: /\b(?:fetch|XMLHttpRequest|EventSource)\s*\(|\bnew\s+(?:globalThis\s*\.\s*)?WebSocket\s*\(|\bnavigator\s*\.\s*(?:sendBeacon|clipboard)\b/i,
    },
    {
        label: 'production host or route',
        pattern: /\b(?:https?|wss?):\/\/|\/fapi\/|(?:fapi|fstream)\.binance\.com/i,
    },
]);
for (const file of rendererProductionFiles) {
    const name = relative(file);
    const source = fs.readFileSync(file, 'utf8');
    for (const { label, pattern } of rendererForbiddenPatterns) {
        if (name === PHASE8_LOCAL_WORKSTATION_CONNECTOR
            && ['renderer-owned network transport', 'production host or route'].includes(label)) {
            continue;
        }
        if (pattern.test(source)) fail(`${name} references forbidden ${label}`);
    }
}

const phase8LocalConnectorPath = path.join(ROOT, PHASE8_LOCAL_WORKSTATION_CONNECTOR);
const phase8LocalConnector = fs.existsSync(phase8LocalConnectorPath)
    ? fs.readFileSync(phase8LocalConnectorPath, 'utf8')
    : '';
const exactLocalUrlSource = '`ws://${host}:${access.port}`';
const connectorWithoutExactLocalUrl = phase8LocalConnector.replace(exactLocalUrlSource, '');
if (!phase8LocalConnector.includes(exactLocalUrlSource)
    || connectorWithoutExactLocalUrl.includes(exactLocalUrlSource)
    || /\b(?:https?|wss?):\/\//i.test(connectorWithoutExactLocalUrl)
    || /\b(?:fetch|XMLHttpRequest|EventSource)\s*\(|\bnavigator\s*\.\s*sendBeacon\s*\(/.test(phase8LocalConnector)
    || [...phase8LocalConnector.matchAll(/new\s+globalThis\.WebSocket\s*\(/g)].length !== 1
    || !/LOOPBACK_HOSTS\.has\(access\.host\)/.test(phase8LocalConnector)
    || !/CONNECT_TIMEOUT_MS:\s*10_000/.test(phase8LocalConnector)
    || !/FUTURES_WORKSTATION_REQUEST_MAX_BYTES/.test(phase8LocalConnector)
    || /(?:fapi|fstream)\.binance\.com|\/fapi\//i.test(phase8LocalConnector)) {
    fail('Phase 8 production view may use only its exact bounded loopback connector');
}

const packageManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const safeDevMainPath = path.join(ROOT, 'electron/main.safe-dev.js');
const safeDevMain = fs.existsSync(safeDevMainPath) ? fs.readFileSync(safeDevMainPath, 'utf8') : '';
const smokeMainPath = path.join(ROOT, 'electron/main.smoke.js');
const smokeMain = fs.existsSync(smokeMainPath) ? fs.readFileSync(smokeMainPath, 'utf8') : '';
const exactSafeDevMain = /^import '\.\/env-setup\.js'\s+await import\('\.\/main\.js'\)\s*$/;
const interactiveElectronScript = packageManifest.scripts?.e ?? '';
const safeDevElectronScript = packageManifest.scripts?.['e:safe'] ?? '';
if (/\bBUILD_MODE\s*=/.test(interactiveElectronScript)
    || !/\bVITE_DEV_SERVER_URL=http:\/\/localhost:5174\b/.test(interactiveElectronScript)
    || !/\bvite\b/.test(interactiveElectronScript)) {
    fail('npm run e must use the normal persistent Electron entry for operator Spot data');
}
if (!/\bBUILD_MODE=safe-dev\b/.test(safeDevElectronScript)
    || /\bBUILD_MODE=smoke\b/.test(safeDevElectronScript)
    || !exactSafeDevMain.test(safeDevMain)
    || /\b(?:SAFE_SMOKE|app\.quit)\b/.test(safeDevMain)) {
    fail('npm run e:safe must use the fake-only persistent Electron entry without a smoke exit');
}
if (!/\bBUILD_MODE=smoke\b/.test(packageManifest.scripts?.['e:smoke'] ?? '')
    || /\bBUILD_MODE=safe-dev\b/.test(packageManifest.scripts?.['e:smoke'] ?? '')
    || !smokeMain.trimStart().startsWith("import './env-setup.js'")
    || !smokeMain.includes("await import('./main.js')")
    || !smokeMain.includes('SAFE_SMOKE_READY')
    || !smokeMain.includes('authenticatedLoopback: true')
    || !smokeMain.includes('reactRootRendered: true')
    || !smokeMain.includes('futuresReady: true')
    || !smokeMain.includes('futuresSliderEnabled: true')
    || !smokeMain.includes('externalFuturesOrderVisible: true')) {
    fail('npm run e:smoke must verify the production UI after fake-only environment/network setup');
}

const viteConfig = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
if (!/\?\s*['"]electron\/main\.safe-dev\.js['"]\s*:\s*['"]electron\/main\.js['"]/.test(viteConfig)) {
    fail('Vite must map the default no-BUILD_MODE launch to the normal Electron main entry');
}
if (!/BUILD_MODE\s*===\s*['"]safe-dev['"]\s*\?\s*['"]electron\/main\.safe-dev\.js['"]/.test(viteConfig)) {
    fail('Vite must map safe-dev mode to the persistent fake-only Electron entry');
}
if (!/BUILD_MODE\s*===\s*['"]smoke['"]\s*\?\s*['"]electron\/main\.smoke\.js['"]/.test(viteConfig)) {
    fail('Vite must map smoke mode only to the bounded Electron smoke entry');
}
if (!/input:\s*['"]electron\/preload\.cjs['"]/.test(viteConfig)
    || !/format:\s*['"]cjs['"]/.test(viteConfig)
    || !/inlineDynamicImports:\s*true/.test(viteConfig)
    || !/entryFileNames:\s*['"]preload\.cjs['"]/.test(viteConfig)
    || /formats:\s*\[\s*['"]cjs['"]\s*\]/.test(viteConfig)) {
    fail('Electron preload must have one non-racing CommonJS output in development and builds');
}

for (const isolatedPath of ['src/context/DataContext.jsx', 'src/utils/tradingCommands.js']) {
    const absolute = path.join(ROOT, isolatedPath);
    if (fs.existsSync(absolute)
        && /futures\.production|futures-production-execution/i.test(fs.readFileSync(absolute, 'utf8'))) {
        fail(`${isolatedPath} contains a production execution action or channel`);
    }
}

const mainPath = path.join(ROOT, 'electron/main.js');
if (fs.existsSync(mainPath)) {
    const main = fs.readFileSync(mainPath, 'utf8');
    const capture = main.indexOf('captureFuturesProductionExecutionConfig(');
    const window = main.indexOf('new BrowserWindow(');
    if (capture < 0 || window < 0 || capture >= window) {
        fail('Production configuration is not captured before the first BrowserWindow');
    }
    if (!/liveAuthorized\s*:\s*FUTURES_PRODUCTION_LIVE_AUTHORIZED\b/.test(main)) {
        fail('Main does not pass the compiled live interlock into production config capture');
    }
}

const compositionPath = path.join(ROOT, FUTURES_PRODUCTION_COMPOSITION);
if (fs.existsSync(compositionPath)) {
    const composition = fs.readFileSync(compositionPath, 'utf8');
    const declarations = [...composition.matchAll(
        /\b(?:export\s+)?const\s+FUTURES_PRODUCTION_LIVE_AUTHORIZED\s*=\s*(true|false)\s*;/g,
    )];
    if (declarations.length !== 1 || declarations[0][1] !== 'true') {
        fail('The reviewed non-environment production live-authorization interlock is not true');
    }
    if (!/canUseLiveTransport\s*=\s*FUTURES_PRODUCTION_LIVE_AUTHORIZED\s*===\s*true\s*&&\s*config\?\.liveAuthorized\s*===\s*true/.test(composition)) {
        fail('Production composition does not require both compiled and captured live gates');
    }
    if (!/config\?\.liveAuthorized\s*===\s*true\s*&&\s*isGlobalFetch\(fetchImpl\)/.test(composition)) {
        fail('Production live composition accepts a caller-supplied transport');
    }
    for (const file of productionExecutionImplementationFiles) {
        const name = relative(file);
        if (name === FUTURES_PRODUCTION_COMPOSITION) continue;
        if (/\b(?:const|let|var)\s+FUTURES_PRODUCTION_LIVE_AUTHORIZED\b/.test(
            fs.readFileSync(file, 'utf8'),
        )) {
            fail(`${name} shadows the compiled production live interlock`);
        }
    }
}

const rendererBundleDirectory = path.join(ROOT, 'dist');
for (const file of walk(rendererBundleDirectory).filter(entry => /\.(?:js|html|css)$/.test(entry))) {
    const source = fs.readFileSync(file, 'utf8');
    const name = relative(file);
    if (/FUTURES_PRODUCTION_(?:API_KEY|API_SECRET|RECOVERY_AUTHORIZATION)/.test(source)
        || /FUTURES_PRODUCTION_EXECUTION_(?:ENABLED|OPERATOR_ACKNOWLEDGEMENT|ACCOUNT_ALIAS|API_KEY_FINGERPRINT|ALLOWED_SYMBOLS|MAX_LEVERAGE|MAX_ORDER_NOTIONAL_USDT|MAX_DAILY_NOTIONAL_USDT|MIN_AVAILABLE_BALANCE_USDT|MIN_LIQUIDATION_DISTANCE_BPS|KILL_SWITCH_POLICY)/.test(source)) {
        fail(`${name} contains production credential or environment configuration`);
    }
    if (/(?:process|Deno|Bun)\s*\.\s*env\b|import\s*\.\s*meta\s*\.\s*env\b/.test(source)) {
        fail(`${name} contains renderer environment access`);
    }
    if (/fapi\.binance\.com|fstream\.binance\.com|\/fapi\//i.test(source)) {
        fail(`${name} contains a production host or route`);
    }

    // The application bundle contains unrelated legacy storage and analytics features.
    // Fail if any such capability is emitted into the Phase 7 module's local bundle region.
    if (name.endsWith('.js')) {
        const anchors = [...source.matchAll(
            /futures-production|FUTURES_PRODUCTION|USDⓈ-M PRODUCTION/gi,
        )].map(match => match.index);
        const forbiddenRuntime = (
            /\b(?:apiKey|apiSecret|recoveryAuthorization|credentials?|authorization|signature|secret|localStorage|sessionStorage|indexedDB|cookieStore|clipboard|analytics|telemetry|Sentry|Crashlytics|crashReporter|captureException|sendBeacon)\b/gi
        );
        for (const match of source.matchAll(forbiddenRuntime)) {
            if (anchors.some(anchor => Math.abs(anchor - match.index) <= 4_096)) {
                fail(`${name} emits ${match[0]} into the production renderer bundle region`);
            }
        }
    }
}

if (failures.length > 0) {
    console.error('Futures production boundary check failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
} else {
    console.log(
        `Futures production boundary check passed (${productionImplementationFiles.length} isolated implementation files).`,
    );
}
