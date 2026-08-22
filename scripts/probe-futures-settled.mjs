// A one-off read of what Binance itself says an open position and the recent
// closed rounds have settled. Run it from the shell the desk runs in, so the
// credentials stay where they already are:
//
//     node scripts/probe-futures-settled.mjs
//
// Reads only. The explicit wallet-comparison section prints per-asset amounts;
// acquisition diagnostics print counts only. Neither prints credentials,
// signed material, raw rows, raw identities, headers, or exchange messages.
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import {
    normalizeFuturesIncomeRow,
    parseFuturesJson,
} from '../electron/services/futures-trading-adapter.js';
import { readFuturesTradeHistoryWindow } from '../electron/services/futures-trade-history-window.js';
import { normalizeFuturesTradeHistoryEvidence } from '../src/utils/futuresTradeHistoryEvidence.js';
import {
    acquireCanonicalFuturesProbeIncome,
    buildCanonicalFuturesProbeReport,
} from './futures-settled-probe-report.mjs';

// Everything printed is also written here, so the result survives the terminal.
// Override with PROBE_OUT=/some/path.
const OUT = process.env.PROBE_OUT || '/tmp/probe-settled.out';
fs.writeFileSync(OUT, '');
const say = (...parts) => {
    const line = parts.join(' ');
    process.stdout.write(line + '\n');
    fs.appendFileSync(OUT, line + '\n');
};
process.on('exit', () => process.stdout.write(`\n--- written to ${OUT} ---\n`));
process.on('uncaughtException', error => {
    say(`FAILED: ${error?.message ?? error}`);
    process.exit(1);
});
process.on('unhandledRejection', error => {
    say(`FAILED: ${error?.message ?? error}`);
    process.exit(1);
});

const KEY = process.env.BFK;
const SECRET = process.env.BFS;
if (!KEY || !SECRET) {
    say('FAILED: BFK/BFS are not set in this environment.');
    process.exit(1);
}
const proxy = process.env.https_proxy || process.env.HTTPS_PROXY || null;
const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
const MAX_PROBE_RESPONSE_BYTES = 8 * 1024 * 1024;

const call = (path, params = {}) => new Promise((resolve, reject) => {
    const query = new URLSearchParams({ ...params, timestamp: Date.now(), recvWindow: 10000 }).toString();
    const signature = crypto.createHmac('sha256', SECRET).update(query).digest('hex');
    const request = https.request({
        host: 'fapi.binance.com',
        path: `${path}?${query}&signature=${signature}`,
        method: 'GET',
        headers: { 'X-MBX-APIKEY': KEY },
        agent,
    }, response => {
        const chunks = [];
        let bytes = 0;
        let refused = false;
        response.on('data', chunk => {
            if (refused) return;
            const held = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += held.length;
            if (bytes > MAX_PROBE_RESPONSE_BYTES) {
                refused = true;
                response.destroy();
                reject(new Error('Probe response exceeded the byte ceiling'));
                return;
            }
            chunks.push(held);
        });
        response.on('end', () => {
            if (refused) return;
            const body = Buffer.concat(chunks, bytes).toString('utf8');
            let parsed = null;
            try {
                parsed = parseFuturesJson(body);
            } catch {
                reject(new Error('Probe response was not valid JSON'));
                return;
            }
            if (response.statusCode !== 200) {
                reject(new Error(`Probe request failed with HTTP ${response.statusCode}`));
                return;
            }
            resolve(parsed);
        });
    });
    request.on('error', () => reject(new Error('Probe transport failed')));
    request.end();
});

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const windowFrom = now - 7 * DAY;
const at = (ms) => {
    const value = Number(ms);
    return Number.isFinite(value)
        ? new Date(value).toISOString().replace('T', ' ').slice(0, 19) + 'Z'
        : '—';
};

const readProbeIncomePage = async ({ incomeType, startTime, endTime, page, limit }) => {
    const answered = await call('/fapi/v1/income', {
        incomeType,
        startTime,
        endTime,
        page,
        limit,
    });
    return {
        rows: Array.isArray(answered)
            ? answered.map(normalizeFuturesIncomeRow)
            : answered,
    };
};

// The comparison consumes exactly the underivable production lanes. Explicit
// page numbers and continuation checkpoints are owned by the same walker the
// desk runs; this script supplies only its read-only HTTP transport.
const incomeWalk = await acquireCanonicalFuturesProbeIncome({
    readPage: readProbeIncomePage,
    now,
    windowFrom,
});
const rows = incomeWalk.rows;
say(`INCOME LANES: ${rows.length} canonical rows over 7 days`);
say(`  oldest ${at(Number(rows[0]?.time))}  newest ${at(Number(rows.at(-1)?.time))}`);
say(`  resource: status=${incomeWalk.resource.status}`
    + ` complete=${incomeWalk.resource.complete}`
    + ` requests=${incomeWalk.requests} passes=${incomeWalk.passes}`
    + `${incomeWalk.exhausted ? ' continuation-limit-reached' : ''}`);
const completedIncomeLanes = Object.values(incomeWalk.resource.lanes)
    .filter(lane => lane.status === 'ready' && lane.complete).length;
say(`  acquisition: reason=operator-probe lanes=${Object.keys(incomeWalk.resource.lanes).length}`
    + ` pages=${incomeWalk.requests} reads=${incomeWalk.requests}`
    + ` physical-attempts=${incomeWalk.requests}`
    + ` charged-weight=${incomeWalk.requests * 30}`
    + ` coverage-gained=${completedIncomeLanes}`);
for (const lane of Object.values(incomeWalk.resource.lanes)) {
    say(`  ${lane.incomeType}: rows=${lane.rows.size}`
        + ` status=${lane.status} complete=${lane.complete}`
        + ` requests=${incomeWalk.attemptsByType[lane.incomeType] ?? 0}`
        + `${lane.error === null ? '' : ` error=${lane.error.code}`}`);
}

// Contract discovery is a distinct production concern: REALIZED_PNL is read
// only for the symbols it names and never enters the wallet ledger. It uses the
// same fixed-window walker so dense timestamp peers remain visible and bounded.
const discoveryWalk = await acquireCanonicalFuturesProbeIncome({
    readPage: readProbeIncomePage,
    now,
    windowFrom,
    incomeTypes: ['REALIZED_PNL'],
});
say(`TRADED-SYMBOL DISCOVERY: rows=${discoveryWalk.rows.length}`
    + ` status=${discoveryWalk.resource.status}`
    + ` complete=${discoveryWalk.resource.complete}`
    + ` requests=${discoveryWalk.requests}`);

const positions = (await call('/fapi/v2/positionRisk')).filter(p => Number(p.positionAmt) !== 0);
say(`\nOPEN POSITION SNAPSHOT: ${positions.length} non-zero position(s)`);

// ---------------------------------------------------------------------------
// Closed rounds through the same canonical ownership boundary as the desk.
// `/userTrades` is read as a bounded frozen window, preserving exact IDs and
// `marginAsset`. The fill fold receives no income. Funding, insurance and
// credits enter exactly once afterwards through `reconcileFuturesWalletLedger`.
const traded = [];
const rememberContract = (value) => {
    const contract = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (contract !== '' && !traded.includes(contract)) traded.push(contract);
};
for (const row of [...rows, ...discoveryWalk.rows]
    .sort((a, b) => Number(b.time) - Number(a.time))) {
    rememberContract(row.symbol);
}
for (const position of positions) rememberContract(position.symbol);
say(`\nCONTRACTS TRADED IN WINDOW: ${traded.length} — ${traded.join(' ')}`);

const fills = [];
const coverageBySymbol = {};
for (const contract of traded) {
    const reading = await readFuturesTradeHistoryWindow({
        startTime: windowFrom,
        endTime: now,
        expectedSymbol: contract,
        readWindow: async ({ startTime, endTime, limit }) => {
            const answered = await call('/fapi/v1/userTrades', {
                symbol: contract,
                startTime,
                endTime,
                limit,
            });
            return Array.isArray(answered)
                ? answered.map(normalizeFuturesTradeHistoryEvidence)
                : answered;
        },
    });
    fills.push(...reading.rows);
    coverageBySymbol[contract] = reading.coverage;
    say(`  ${contract}: ${reading.rows.length} contiguous fills,`
        + ` ${reading.unresolvedRows.length} held behind an unread gap,`
        + ` ${reading.coverage.requests} request(s),`
        + ` coverage=${reading.coverage.complete ? 'complete' : 'PARTIAL'}`
        + (reading.rows.length > 0
            ? `, oldest ${at(Math.min(...reading.rows.map(fill => Number(fill.time))))}`
            : ''));
}

const report = buildCanonicalFuturesProbeReport({
    fills,
    income: rows,
    coverageBySymbol,
    // The complete account snapshot names non-zero positions; absence from
    // that successfully read snapshot is the authoritative terminal zero.
    positions,
    generation: `probe:${now}`,
    incomeCoverage: incomeWalk.resource.complete,
});
const amounts = totals => (totals ?? [])
    .map(total => `${total.amount} ${total.asset}`)
    .join(' + ') || '0';
const componentAmounts = entries => (entries ?? [])
    .map(entry => `${entry.component}=${entry.amount} ${entry.asset}`)
    .join(' | ') || 'none';

say(`\nOPEN ROUNDS: ${report.open.length}`);
for (const { round, wallet } of report.open) {
    say(`\n  ${round.symbol} ${round.positionSide} qty=${round.quantity}`);
    say(`    owned components: ${componentAmounts(wallet?.entries)}`);
    say(`    visible NET: ${amounts(wallet?.visibleNet)}`);
    say(`    canonical NET: ${wallet?.walletNet === null || wallet?.walletNet === undefined
        ? 'NOT EXACT'
        : `${wallet.walletNet.amount} ${wallet.walletNet.asset}`}`);
    if ((wallet?.qualifications ?? []).length > 0) {
        say(`    qualifications: ${wallet.qualifications.join(', ')}`);
    }
}

say(`\nCLOSED ROUNDS: ${report.closed.length}`
    + ` (${report.roundIndex.unresolved.length} unresolved segment(s))`);
for (const { round, wallet } of report.closed) {
    say(`\n  ${round.symbol} ${round.positionSide} qty=${round.quantity}`);
    say(`    opened ${at(round.openTime)}  closed ${at(round.closeTime)}`
        + `  fills=${round.fillIds.length}`);
    say(`    entry ${round.entryPrice === null ? '—' : round.entryPrice}`
        + `${round.entryImplied ? ' (implied)' : ''}  exit ${round.exitPrice}`);
    say(`    owned components: ${componentAmounts(wallet?.entries)}`);
    say(`    visible NET: ${amounts(wallet?.visibleNet)}`);
    say(`    canonical NET: ${wallet?.walletNet === null || wallet?.walletNet === undefined
        ? 'NOT EXACT'
        : `${wallet.walletNet.amount} ${wallet.walletNet.asset}`}`);
    if ((wallet?.qualifications ?? []).length > 0) {
        say(`    qualifications: ${wallet.qualifications.join(', ')}`);
    }
}

say(`\nACCOUNT SHARED ADJUSTMENTS: ${report.shared.length}`);
for (const bucket of report.shared) {
    say(`  ${bucket.kind}:${bucket.ownerId}`
        + `  components=${bucket.components.join(',') || 'none'}`
        + `  NET=${amounts(bucket.visibleNet)}`
        + (bucket.qualifications.length > 0
            ? `  [${bucket.qualifications.join(', ')}]`
            : ''));
}
say(`\nWALLET AUDIT: conserved=${report.walletLedger.audit.conserved}`
    + ` disjoint=${report.walletLedger.audit.disjoint}`
    + ` presentationDisjoint=${report.walletLedger.audit.presentationDisjoint}`
    + ` additive=${report.walletLedger.audit.additive}`);
say(`  canonical totals: ${amounts(report.walletLedger.audit.canonicalTotals)}`);
say(`  assigned totals:  ${amounts(report.walletLedger.audit.assignedTotals)}`);
say(`  skipped derivable/unsupported income rows: ${report.walletLedger.audit.skippedIncome.length}`);
say(`  identity conflicts: ${report.walletLedger.audit.identityConflicts.length}`
    + `  invalid inputs: ${report.walletLedger.audit.invalidInputs.length}`);

// ---------------------------------------------------------------------------
say('\n--- ACQUISITION SHAPE (COUNTS ONLY) ---');
// Aggregate shape only. Money is printed in the explicit canonical wallet
// comparison above, while this acquisition diagnostic answers whether each
// credit lane carries evidence that can support position ownership.
{
    const REBATES = ['COMMISSION_REBATE', 'REFERRAL_KICKBACK', 'API_REBATE', 'FEE_RETURN'];
    const rebates = rows.filter(r => REBATES.includes(r.incomeType));
    say(`  rebate rows in the window: ${rebates.length}`);
    if (rebates.length > 0) {
        const named = rebates.filter(r => typeof r.symbol === 'string' && r.symbol.length > 0);
        const tradeNamed = rebates.filter(r => r.tradeId !== null);
        say(`    contract evidence present: ${named.length}; absent: ${rebates.length - named.length}`);
        say(`    trade identity present: ${tradeNamed.length}; absent: ${rebates.length - tradeNamed.length}`);
        for (const type of REBATES) {
            const of = rebates.filter(r => r.incomeType === type);
            if (of.length > 0) say(`    ${type}: ${of.length} row(s)`);
        }
    }
}
const isolatedPositions = positions.filter(position => (
    position.marginType === 'isolated' || position.isolated === true
)).length;
say(`  open-position shape: total=${positions.length}`
    + ` isolated=${isolatedPositions} cross-or-unknown=${positions.length - isolatedPositions}`);
