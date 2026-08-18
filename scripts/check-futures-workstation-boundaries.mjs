import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const failures = [];

const PRODUCTION_TRANSPORT = 'electron/services/futures-production-workstation-transport.js';
const NETWORK_GUARD = 'electron/futures-workstation-node-network-guard.js';
const PRODUCTION_COMPOSITION = 'electron/services/futures-production-workstation-composition.js';
const PRODUCTION_VERIFICATION_COMPOSITION = 'electron/services/futures-production-workstation-verification-composition.js';
const PRODUCTION_PROTOCOL = 'src/utils/futuresProductionWorkstationProtocol.js';
const LOCAL_WORKSTATION_CONNECTOR = 'src/hooks/useFuturesLocalWorkstationConnection.js';
const PRODUCTION_WORKSTATION_CONTAINER = (
    'src/components/features/futures/FuturesProductionWorkstation.jsx'
);
const FUTURES_WORKSPACE = 'src/workspaces/FuturesWorkspace.jsx';
const GATEWAY_CONTEXT = 'src/context/GatewayContext.jsx';

const EXACT_ORIGINS = Object.freeze(new Map([
    ['https://fapi.binance.com', PRODUCTION_TRANSPORT],
    ['wss://fstream.binance.com', PRODUCTION_TRANSPORT],
]));
const REVIEWED_PUBLIC_READ_ROUTES = Object.freeze(new Set([
    '/fapi/v1/exchangeInfo',
    '/fapi/v1/depth',
    '/fapi/v1/klines',
    '/fapi/v1/indexPriceKlines',
    '/fapi/v1/premiumIndex',
    '/fapi/v1/ticker/24hr',
]));
const REVIEWED_STREAM_PATHS = Object.freeze(new Set([
    '/public/stream',
    '/market/stream',
]));
const NETWORK_MODULES = Object.freeze(new Set([
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

const walk = (directory) => {
    if (!fs.existsSync(directory)) return [];
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('dist')) {
            continue;
        }
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walk(absolute));
        else files.push(absolute);
    }
    return files;
};

const readModuleSpecifiers = (source) => {
    const specifiers = [];
    const pattern = (
        /\b(?:from|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm
    );
    for (const match of source.matchAll(pattern)) specifiers.push(match[1] ?? match[2]);
    return specifiers;
};

const topLevelModule = (specifier) => {
    const normalized = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    return normalized.startsWith('@')
        ? normalized.split('/').slice(0, 2).join('/')
        : normalized.split('/')[0];
};

const workstationFiles = [
    ...walk(path.join(ROOT, 'electron')),
    ...walk(path.join(ROOT, 'src')),
].filter(file => (
    /workstation/i.test(path.basename(file))
    && /\.(?:c?js|mjs|jsx|css)$/.test(file)
    && !/\.test\.[^.]+$/.test(file)
));
const workstationNames = new Set(workstationFiles.map(relative));
const sources = new Map(workstationFiles.map(file => [relative(file), fs.readFileSync(file, 'utf8')]));

for (const required of [
    PRODUCTION_TRANSPORT,
    NETWORK_GUARD,
    PRODUCTION_COMPOSITION,
    PRODUCTION_VERIFICATION_COMPOSITION,
    PRODUCTION_PROTOCOL,
    LOCAL_WORKSTATION_CONNECTOR,
]) {
    if (!workstationNames.has(required)) fail(`Missing required isolated workstation module ${required}`);
}

for (const [origin, owner] of EXACT_ORIGINS) {
    const owners = [];
    let occurrences = 0;
    for (const [name, source] of sources) {
        const count = source.split(origin).length - 1;
        if (count > 0) owners.push(name);
        occurrences += count;
    }
    if (occurrences !== 1 || owners.length !== 1 || owners[0] !== owner) {
        fail(`${origin} must occur exactly once and only in ${owner}`);
    }
}

for (const [name, source] of sources) {
    const isReviewedTransport = name === PRODUCTION_TRANSPORT;
    const isNetworkGuard = name === NETWORK_GUARD;
    const isLocalWorkstationConnector = name === LOCAL_WORKSTATION_CONNECTOR;

    for (const specifier of readModuleSpecifiers(source)) {
        if (NETWORK_MODULES.has(topLevelModule(specifier))
            && !isReviewedTransport
            && !isNetworkGuard) {
            fail(`${name} imports forbidden network module ${specifier}`);
        }
    }

    if (!isReviewedTransport
        && !isNetworkGuard
        && !isLocalWorkstationConnector
        && /\b(?:globalThis\s*\.\s*)?fetch\s*\(|\bnew\s+(?:globalThis\s*\.\s*)?WebSocket\s*\(|\bXMLHttpRequest\s*\(|\bEventSource\s*\(/.test(source)) {
        fail(`${name} creates a network transport outside a reviewed backend transport`);
    }

    if (!isReviewedTransport && !isNetworkGuard
        && /(?:fapi|fstream)\.binance\.com|\/fapi\//i.test(source)) {
        fail(`${name} contains a Binance host or route outside a reviewed backend transport`);
    }

    if (/\bmethod\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(source)) {
        fail(`${name} contains a write-capable HTTP method`);
    }
    if (/\/fapi\/v\d+\/(?:order|batchOrders|allOpenOrders|algoOrder|algoOpenOrders|leverage|marginType|positionSide\/dual|listenKey|countdownCancelAll)\b/i.test(source)) {
        fail(`${name} contains an execution, safety-write, or account-configuration route`);
    }
}

for (const transportName of [PRODUCTION_TRANSPORT]) {
    const source = sources.get(transportName) ?? '';
    const routes = new Set([...source.matchAll(/\/fapi\/v\d+\/[A-Za-z0-9._/-]+/g)].map(match => match[0]));
    if (routes.size !== REVIEWED_PUBLIC_READ_ROUTES.size
        || [...routes].some(route => !REVIEWED_PUBLIC_READ_ROUTES.has(route))) {
        fail(`${transportName} route registry differs from the reviewed public-read set`);
    }
    for (const route of REVIEWED_PUBLIC_READ_ROUTES) {
        if (!routes.has(route)) fail(`${transportName} is missing reviewed public-read route ${route}`);
    }
    const streamPaths = new Set(
        [...source.matchAll(/['"]\/(?:public|market)\/stream['"]/g)]
            .map(match => match[0].slice(1, -1)),
    );
    if (streamPaths.size !== REVIEWED_STREAM_PATHS.size
        || [...streamPaths].some(route => !REVIEWED_STREAM_PATHS.has(route))) {
        fail(`${transportName} stream path registry differs from the reviewed routed-stream set`);
    }
    if ([...source.matchAll(/\bglobalThis\s*\.\s*fetch\s*\(/g)].length !== 1
        || !/\bmethod\s*:\s*['"]GET['"]/.test(source)) {
        fail(`${transportName} must have one backend fetch dispatch point and GET only`);
    }
    if (!/\bredirect\s*:\s*['"]error['"]/.test(source)
        || !/response\?\.redirected\s*===\s*true/.test(source)
        || !/response\?\.url\s*!==\s*url\.href/.test(source)) {
        fail(`${transportName} does not fail closed on redirects or alternate final URLs`);
    }
    if (!/followRedirects\s*:\s*false/.test(source)
        || !/handshakeTimeout\s*:\s*10_000/.test(source)
        // The upstream ceiling is derived from the book the desk retains, not
        // from a flat number under it: a depth diff on a sharp move restates
        // every level, and a frame the desk refuses is market data lost at the
        // moment it matters. It stays pinned — to the derived bound.
        || !/maxPayload\s*:\s*FUTURES_WORKSTATION_JSON_LIMITS\.WS_STREAM_FRAME_BYTES/.test(source)
        || !/perMessageDeflate\s*:\s*false/.test(source)) {
        fail(`${transportName} does not pin the reviewed bounded WebSocket options`);
    }
    if (/\b(?:headers|body|credentials|mode|cache|referrer|dispatcher|proxy|socketFactory)\s*:/.test(source)) {
        fail(`${transportName} contains caller-controlled or credential-bearing network options`);
    }
    const fixedAgentAssignments = [...source.matchAll(/\bagent\s*:/g)].length;
    const fixedProxyRequests = [...source.matchAll(/\bhttps\.request\s*\(/g)].length;
    const environmentResolver = 'resolveProductionBackendProxy';
    if (fixedAgentAssignments !== 2
        || fixedProxyRequests !== 1
        || !source.includes('agent: proxyAgent')
        || !source.includes('{ agent: backendProxy.proxyAgent }')
        || !source.includes('maxHeaderSize: FUTURES_WORKSTATION_JSON_LIMITS.HEADER_AGGREGATE_BYTES')
        || !source.includes("errorCode: 'INVALID_PROXY_CONFIGURATION'")
        || !source.includes(`const ${environmentResolver} = () =>`)
        || !source.includes(`const backendProxy = ${environmentResolver}();`)
        || !/createFuturesProductionWorkstationReviewedTransport\s*=/.test(source)) {
        fail(`${transportName} does not isolate its fixed backend-owned proxy agent`);
    }
}

const productionComposition = sources.get(PRODUCTION_COMPOSITION) ?? '';
if (!/export const FUTURES_PRODUCTION_WORKSTATION_PUBLIC_READ_AUTHORIZED\s*=\s*true\s*;/.test(productionComposition)
    || !/createFuturesProductionWorkstationReviewedTransport\(\{ onTiming \}\)/.test(productionComposition)
    || /FakeTransport|deterministic-fake/.test(productionComposition)) {
    fail('Normal Production operator composition must be source-pinned to reviewed public reads');
}
const productionVerificationComposition = sources.get(PRODUCTION_VERIFICATION_COMPOSITION) ?? '';
if (!/FUTURES_PRODUCTION_WORKSTATION_DETERMINISTIC_VERIFICATION\s*=\s*true\s*;/.test(productionVerificationComposition)
    || !/createFuturesProductionWorkstationFakeTransport\(\)/.test(productionVerificationComposition)
    || /ReviewedTransport|reviewed-public-read/.test(productionVerificationComposition)) {
    fail('Production verification composition must be source-pinned to its deterministic fake');
}
const allCompositions = [
    productionComposition,
    productionVerificationComposition,
].join('\n');
if (/process\s*\.\s*env|import\s*\.\s*meta\s*\.\s*env/.test(allCompositions)) {
    fail('A workstation transport interlock is environment-selectable');
}
for (const composition of [productionComposition, productionVerificationComposition]) {
    if (!/createFuturesProductionWorkstationRuntime\s*=\s*\(\{\s*onTiming,\s*onInternalError\s*\}/
        .test(composition)) {
        fail('A workstation composition drops the fault reporter before the service');
    }
}
// The faults the desk absorbs — a book that could not bridge, a recovery, a
// rejected frame — reach the operator only through this reporter, and it
// defaults to a no-op. Unwired, the operator watched a bootstrap fail four
// times a cycle with nothing in the log saying why.
const operatorConnection = fs.readFileSync(
    path.join(ROOT, 'electron/services/binance-connection.js'),
    'utf8',
);
if (!/onInternalError:\s*\(\{\s*phase,\s*code\s*\}\)\s*=>\s*\{[^}]*futures-production-workstation:fault/
    .test(operatorConnection)) {
    fail('The operator connection does not log the faults the workstation absorbs');
}

const viteConfig = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
for (const buildMode of ['safe-dev', 'smoke']) {
    if (!viteConfig.includes(`'${buildMode}'`)) {
        fail(`Vite is missing deterministic workstation build mode ${buildMode}`);
    }
}
if (!viteConfig.includes('process.env.VITEST')
    || !/verificationCompositionPath\(['"]production['"]\)/.test(viteConfig)
    || [...viteConfig.matchAll(/alias:\s*futuresWorkstationCompositionAliases/g)].length !== 2) {
    fail('Safe, smoke and Vitest builds must resolve deterministic workstation compositions');
}
const vitestConfig = fs.readFileSync(path.join(ROOT, 'vitest.config.js'), 'utf8');
if (!/selectFuturesWorkstationCompositionAliases\(\{\s*isVitest:\s*true\s*\}\)/.test(vitestConfig)) {
    fail('Vitest must source-pin both workstation environments to deterministic compositions');
}

for (const [name, source] of sources) {
    if (/futures-production-workstation|FuturesProductionWorkstation/.test(name)
        && /futures[-_]?testnet|FuturesTestnet|futures[-_]?readonly|FuturesReadOnly|testnet[-_]?execution/i.test(source)) {
        fail(`${name} references a retired Testnet/Phase 5/6 boundary`);
    }
}

const productionProtocol = sources.get(PRODUCTION_PROTOCOL) ?? '';
if (!productionProtocol.includes("'futures-production-workstation'")
    || productionProtocol.includes("'futures-testnet-workstation'")) {
    fail('Production workstation protocol does not own one exact isolated channel');
}
for (const [name, source] of [[PRODUCTION_PROTOCOL, productionProtocol]]) {
    const actions = [...source.matchAll(/['"]futures\.production\.workstation\.([a-z-]+)['"]/g)]
        .map(match => match[1]);
    const allowed = new Set([
        'resource',
        // Typed answer to a reviewed history read that no live session owns.
        // It carries only the rejected subscription identity and selection;
        // no exchange route or write authority is added by the outcome.
        'history-outcome',
        'subscribe',
        'select-symbol',
        'select-interval',
        'configure-tape',
        // Reviewed read: how far past the best price the rows on screen reach.
        // It carries one decimal and no market authority; all it decides is
        // which page of the depth route already in the reviewed set is asked
        // for — a shallower one than the desk used to buy unconditionally.
        'configure-depth',
        // Reviewed read: candles behind the live window, over the public klines
        // route already in the reviewed set, bounded by contract, interval, a
        // point in time and a page size. It reads nothing the subscription
        // itself does not already read.
        'load-candle-history',
        'unsubscribe',
    ]);
    if (actions.length !== 9 || actions.some(action => !allowed.has(action))) {
        fail(`${name} exposes an action outside the exact read-only workstation protocol`);
    }
}

const rendererSources = [...sources]
    .filter(([name]) => name.startsWith('src/'));
const rendererForbidden = Object.freeze([
    ['credential material', /\b(?:api[-_]?key|api[-_]?secret|credential(?:s|binding)?|authorization|signature|listen[-_]?key|recovery[-_]?authorization)\b/i],
    ['browser storage', /\b(?:localStorage|sessionStorage|indexedDB|cookieStore|CacheStorage|StorageManager)\b|\bdocument\s*\.\s*cookie\b|\bcaches\s*\.\s*open\s*\(/i],
    ['clipboard', /\bclipboard\b/i],
    ['analytics, telemetry, or crash reporting', /\b(?:analytics|telemetry|Sentry|Crashlytics|crashReporter|captureException|datadog|mixpanel|segment|amplitude|posthog)\b/i],
    ['environment access', /(?:process|Deno|Bun)\s*\.\s*env\b|import\s*\.\s*meta\s*\.\s*env\b/i],
    ['renderer network', /\b(?:fetch|XMLHttpRequest|EventSource)\s*\(|\bnew\s+(?:globalThis\s*\.\s*)?WebSocket\s*\(|\bnavigator\s*\.\s*sendBeacon\s*\(/i],
    ['Binance host or route', /(?:fapi|fstream)\.binance\.com|\/fapi\//i],
    ['Spot command/context coupling', /(?:DataContext|tradingCommands)/],
]);
for (const [name, source] of rendererSources) {
    for (const [label, pattern] of rendererForbidden) {
        if (name === LOCAL_WORKSTATION_CONNECTOR && label === 'renderer network') continue;
        if (pattern.test(source)) fail(`${name} references forbidden ${label}`);
    }
}

const localWorkstationConnector = sources.get(LOCAL_WORKSTATION_CONNECTOR) ?? '';
const exactLocalUrlSource = '`ws://${host}:${access.port}`';
const connectorWithoutExactLocalUrl = localWorkstationConnector.replace(exactLocalUrlSource, '');
if (!localWorkstationConnector.includes(exactLocalUrlSource)
    || connectorWithoutExactLocalUrl.includes(exactLocalUrlSource)
    || /\b(?:https?|wss?):\/\//i.test(connectorWithoutExactLocalUrl)
    || /\b(?:fetch|XMLHttpRequest|EventSource)\s*\(|\bnavigator\s*\.\s*sendBeacon\s*\(/.test(localWorkstationConnector)
    || !/globalThis\.ccTradeRuntime\?\.localWebSocketAccess/.test(localWorkstationConnector)
    || !/LOOPBACK_HOSTS\.has\(access\.host\)/.test(localWorkstationConnector)
    || !/access\.tokenParam !== ['"]token['"]/.test(localWorkstationConnector)
    || !/const useFuturesLocalWorkstationConnection = \(\{ enabled \}\) =>/.test(localWorkstationConnector)
    || [...localWorkstationConnector.matchAll(/new\s+globalThis\.WebSocket\s*\(/g)].length !== 1
    || !/CONNECT_TIMEOUT_MS:\s*10_000/.test(localWorkstationConnector)
    || !/RECONNECT_ATTEMPTS:\s*8/.test(localWorkstationConnector)
    || !/FUTURES_WORKSTATION_REQUEST_MAX_BYTES/.test(localWorkstationConnector)) {
    fail('The reviewed renderer connector must own one exact bounded loopback WebSocket');
}

const appSource = fs.readFileSync(path.join(ROOT, 'src/App.jsx'), 'utf8');
const gatewaySource = fs.readFileSync(path.join(ROOT, GATEWAY_CONTEXT), 'utf8');
const futuresWorkspace = fs.readFileSync(path.join(ROOT, FUTURES_WORKSPACE), 'utf8');
const productionWorkstationContainer = sources.get(PRODUCTION_WORKSTATION_CONTAINER) ?? '';
const sharedGatewayAssertions = [
    ['App Gateway ownership', /<GatewayProvider\s+activeMarketMode=\{marketMode\}>/.test(appSource)],
    ['Gateway WebSocket ownership', /useWebSocket\(\s*wsUrl,/.test(gatewaySource)],
    ['Futures Gateway consumption', /useGatewayContext\(\)/.test(futuresWorkspace)],
    [
        'Futures execution hook wiring',
        // The activation generation is part of the wiring: every market-scoped
        // frame carries the activation it was issued under, and the execution
        // hook writes to the socket itself.
        /useFuturesTrading\(\{\s*enabled:\s*startupStatus\?\.ready\s*===\s*true,\s*wsConnection,\s*marketGeneration,\s*\}\)/.test(futuresWorkspace),
    ],
    [
        'Futures workstation wiring',
        /<FuturesProductionWorkstation\s+enabled\s+executionState=\{futuresTrading\}\s+(?:marketClock=\{marketClock\}\s+)?wsConnection=\{wsConnection\}\s+sendMessage=\{sendMessage\}\s*\/>/.test(futuresWorkspace),
    ],
    [
        'Futures workstation transport props',
        /export const FuturesProductionWorkstation = \(\{\s*enabled,\s*executionState,\s*(?:marketClock\s*=\s*null,\s*)?wsConnection,\s*sendMessage,\s*\}\) =>/.test(productionWorkstationContainer),
    ],
    [
        'Futures hook transport props',
        /useFuturesProductionWorkstation\(\{\s*enabled,\s*symbol,\s*interval,\s*wsConnection,\s*sendMessage,\s*\}\)/.test(productionWorkstationContainer),
    ],
    [
        'No second Futures connector',
        !/useFutures(?:Local|Production)WorkstationConnection/.test(productionWorkstationContainer),
    ],
];
for (const [label, passed] of sharedGatewayAssertions) {
    if (!passed) {
        fail(`Futures shared Gateway boundary is missing: ${label}`);
    }
}

for (const pureView of [
    'src/components/features/futures/FuturesWorkstationView.jsx',
    'src/components/features/futures/FuturesWorkstationChart.jsx',
]) {
    const source = sources.get(pureView) ?? '';
    if (/useFuturesProductionWorkstation|sendMessage|wsConnection|\.workstation\.(?:subscribe|select|unsubscribe)/.test(source)) {
        fail(`${pureView} is not a pure normalized-props presentation boundary`);
    }
    if (/\bonKeyDown\s*=|addEventListener\s*\(\s*['"]keydown['"]/.test(source)) {
        fail(`${pureView} contains a generic keyboard action handler`);
    }
}

for (const file of walk(path.join(ROOT, 'dist')).filter(entry => /\.(?:js|html|css)$/.test(entry))) {
    const source = fs.readFileSync(file, 'utf8');
    if (/(?:demo-)?(?:fapi|fstream)\.binance\.com|\/fapi\//i.test(source)) {
        fail(`${relative(file)} emits a Binance workstation host or route into the renderer bundle`);
    }
    if (/FUTURES_(?:PRODUCTION|TESTNET)_WORKSTATION_(?:REST|WSS)_ORIGIN/.test(source)) {
        fail(`${relative(file)} emits a backend workstation origin constant into the renderer bundle`);
    }
}

if (failures.length > 0) {
    console.error('Futures workstation boundary check failed:');
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
} else {
    console.log(
        `Futures workstation boundary check passed (${workstationFiles.length} isolated implementation files; exact public-read routes only).`,
    );
}
