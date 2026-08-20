// A one-off read of what Binance itself says an open position and the recent
// closed rounds have settled. Run it from the shell the desk runs in, so the
// credentials stay where they already are:
//
//     node scripts/probe-futures-settled.mjs
//
// Reads only. Prints numbers and times; never the key, never the secret.
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';

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
        let body = '';
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
            let parsed = null;
            try { parsed = JSON.parse(body); } catch { /* keep null */ }
            if (response.statusCode !== 200) {
                reject(new Error(`${path} ${response.statusCode} ${body.slice(0, 200)}`));
                return;
            }
            resolve(parsed);
        });
    });
    request.on('error', reject);
    request.end();
});

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const windowFrom = now - 7 * DAY;
const usdt = value => Number(value).toFixed(4);
const at = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + 'Z';

// The income record, walked the way the desk walks it, so the walk itself is
// under test here too: ascending pages, forward from the window's start.
const income = [];
// How many rows a key would collapse *within a single page*. Pages overlap by
// design — the walk re-asks the edge instant so a row sharing it is not skipped
// — so counting collisions across pages measures the overlap and nothing else.
// Inside one page every row is a distinct charge the exchange made, and a key
// that maps two of them to one string is losing money the account really paid.
const collisions = { safeTranId: 0, natural: 0, naturalWithTrade: 0, rows: 0 };
const safeId = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? String(parsed) : null;
};
const measurePage = (page) => {
    const keys = {
        // What the desk keyed by before 2026-08-20: type and transaction, with
        // an unusable transaction refused and left empty.
        safeTranId: row => `${row.incomeType}:${safeId(row.tranId) ?? ''}`,
        // The first fallback: what the row is.
        natural: row => (safeId(row.tranId) !== null
            ? `${row.incomeType}:${safeId(row.tranId)}`
            : `${row.incomeType}:${row.symbol}:${row.time}:${row.income}`),
        // The same, plus the fill the charge was made on.
        naturalWithTrade: row => (safeId(row.tranId) !== null
            ? `${row.incomeType}:${safeId(row.tranId)}`
            : `${row.incomeType}:${row.symbol}:${row.time}:${row.income}:${safeId(row.tradeId) ?? ''}`),
    };
    collisions.rows += page.length;
    for (const [name, keyOf] of Object.entries(keys)) {
        const seen = new Set();
        for (const row of page) {
            const key = keyOf(row);
            if (seen.has(key)) collisions[name] += 1;
            seen.add(key);
        }
    }
};
{
    let cursor = windowFrom;
    let guard = 0;
    while (guard < 60) {
        guard += 1;
        const page = await call('/fapi/v1/income', { startTime: cursor, endTime: now, limit: 1000 });
        if (!Array.isArray(page) || page.length === 0) break;
        measurePage(page);
        income.push(...page);
        if (page.length < 1000) break;
        const newest = page.reduce((latest, row) => Math.max(latest, Number(row.time)), cursor);
        if (newest <= cursor) break;
        cursor = newest;
    }
}
const byId = new Map();
for (const row of income) byId.set(`${row.incomeType}:${row.tranId}`, row);
const rows = [...byId.values()].sort((a, b) => Number(a.time) - Number(b.time));
say(`INCOME: ${rows.length} rows over 7 days`);
say(`  oldest ${at(Number(rows[0]?.time))}  newest ${at(Number(rows.at(-1)?.time))}`);
say(`  first page ordering: ${Number(income[0]?.time) < Number(income[Math.min(999, income.length - 1)]?.time) ? 'ASCENDING' : 'DESCENDING'}`);
const kinds = {};
for (const row of rows) kinds[row.incomeType] = (kinds[row.incomeType] ?? 0) + 1;
say('  by type:', Object.entries(kinds).map(([k, n]) => `${k}=${n}`).join(' '));
say(`  rows the exchange gave no usable tranId: ${income.filter(r => safeId(r.tranId) === null).length} of ${income.length}`);
say('  ROWS LOST TO A KEY COLLISION, counted inside single pages'
    + ` (${collisions.rows} rows read):`);
say(`    type:tranId only ......... ${collisions.safeTranId}`);
say(`    + natural fallback ....... ${collisions.natural}`);
say(`    + the fill it was on ..... ${collisions.naturalWithTrade}`);

const positions = (await call('/fapi/v2/positionRisk')).filter(p => Number(p.positionAmt) !== 0);
say(`\nOPEN POSITIONS: ${positions.length}`);

for (const position of positions) {
    const symbol = position.symbol;
    // When this position opened, from the fills themselves: walk the account's
    // trades on this contract backwards, undoing each fill, until the running
    // position reaches zero. That instant is the opening.
    const fills = (await call('/fapi/v1/userTrades', { symbol, limit: 1000 }))
        .sort((a, b) => Number(a.time) - Number(b.time));
    let running = 0;
    let openedAt = null;
    let reached = false;
    for (let i = fills.length - 1; i >= 0; i -= 1) {
        const fill = fills[i];
        const signed = fill.side === 'BUY' ? Number(fill.qty) : -Number(fill.qty);
        running -= signed;
        openedAt = Number(fill.time);
        if (Math.abs(running + Number(position.positionAmt)) < 1e-12) { reached = true; break; }
    }
    say(`\n  ${symbol} ${position.positionSide} amt=${position.positionAmt} entry=${position.entryPrice}`);
    say(`    uPnL (exchange): ${usdt(position.unRealizedProfit)}`);
    say(`    opened at: ${reached ? at(openedAt) : 'NOT REACHED within 1000 fills'}  (fills read: ${fills.length}, oldest ${at(Number(fills[0]?.time))})`);
    const since = reached ? openedAt : null;
    const scoped = rows.filter(r => r.symbol === symbol && (since === null || Number(r.time) >= since));
    const sum = type => scoped.filter(r => r.incomeType === type)
        .reduce((total, r) => total + Number(r.income), 0);
    const realized = sum('REALIZED_PNL');
    const funding = sum('FUNDING_FEE');
    const commission = sum('COMMISSION') + sum('COMMISSION_REBATE') + sum('REFERRAL_KICKBACK');
    const insurance = sum('INSURANCE_CLEAR');
    say(`    since open -> realized ${usdt(realized)} | funding ${usdt(funding)} | commission ${usdt(commission)} | insurance ${usdt(insurance)}`);
    say(`    SETTLED TOTAL: ${usdt(realized + funding + commission + insurance)}`);
    const fundingRows = scoped.filter(r => r.incomeType === 'FUNDING_FEE');
    say(`    funding charges since open: ${fundingRows.length}`);
    for (const row of fundingRows) say(`      ${at(Number(row.time))}  ${usdt(row.income)} ${row.asset}`);
    // And the whole contract's week, which is what the desk prints when it does
    // not know the opening.
    const all = rows.filter(r => r.symbol === symbol);
    const allSum = all.reduce((total, r) => total + Number(r.income), 0);
    say(`    (whole contract over 7 days, all types: ${usdt(allSum)} across ${all.length} rows)`);
}

// ---------------------------------------------------------------------------
// The closed rounds, folded by the desk's own code against the exchange's own
// records. Nothing here is a re-implementation: `buildFuturesTradeRounds` and
// `readFuturesSettledIncome` are the modules the desk runs, imported directly,
// so a number printed below and a number on the screen differ only where the
// data reaching them differs. That is the whole point — the operator compares
// these rows against the Binance app, and whatever disagrees is either the
// fold or the data, and this says which.
const { default: buildFuturesTradeRounds } = await import('../src/utils/futuresTradeRounds.js');
const { readFuturesSettledIncome } = await import('../src/utils/futuresSettledMoney.js');

// The adapter refuses an identity it cannot carry — a JSON integer past 2^53
// has already lost digits — and the walk keys such a row by what it is instead.
// Reproduced here so the probe holds exactly what the desk holds.
const identity = (value) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? String(parsed) : null;
};

const deskIncome = rows.map(row => ({
    symbol: typeof row.symbol === 'string' && row.symbol.length > 0 ? row.symbol.toUpperCase() : null,
    incomeType: row.incomeType ?? null,
    income: String(row.income ?? '0'),
    asset: row.asset ?? null,
    time: Number(row.time) || 0,
    tranId: identity(row.tranId),
    tradeId: identity(row.tradeId),
}));
const deskEntries = readFuturesSettledIncome(deskIncome);
say(`\nINCOME READ INTO COMPONENTS: ${deskEntries.length} of ${deskIncome.length} rows`);
{
    const per = {};
    for (const entry of deskEntries) per[entry.component] = (per[entry.component] ?? 0) + 1;
    say('  ', Object.entries(per).map(([k, n]) => `${k}=${n}`).join(' '));
}

// Every contract the account touched in the window, newest activity first —
// the same set the desk discovers, from the same rows.
const traded = [];
for (const row of [...rows].sort((a, b) => Number(b.time) - Number(a.time))) {
    const contract = typeof row.symbol === 'string' ? row.symbol.toUpperCase() : '';
    if (contract !== '' && !traded.includes(contract)) traded.push(contract);
}
say(`\nCONTRACTS TRADED IN WINDOW: ${traded.length} — ${traded.join(' ')}`);

const fills = [];
for (const contract of traded) {
    // Exactly what the desk asks for: the most recent thousand fills, no
    // startTime. What that does or does not reach is part of what is measured.
    const answered = await call('/fapi/v1/userTrades', { symbol: contract, limit: 1000 });
    for (const fill of Array.isArray(answered) ? answered : []) {
        fills.push({
            id: identity(fill.id),
            orderId: identity(fill.orderId),
            symbol: fill.symbol ?? null,
            side: fill.side ?? null,
            positionSide: fill.positionSide ?? 'BOTH',
            price: fill.price ?? '0',
            quantity: fill.qty ?? '0',
            quoteQty: fill.quoteQty ?? '0',
            realizedPnl: fill.realizedPnl ?? '0',
            commission: fill.commission ?? '0',
            commissionAsset: fill.commissionAsset ?? null,
            maker: fill.maker === true,
            time: Number(fill.time) || 0,
        });
    }
    say(`  ${contract}: ${Array.isArray(answered) ? answered.length : 0} fills`
        + (Array.isArray(answered) && answered.length > 0
            ? `, oldest ${at(Math.min(...answered.map(f => Number(f.time))))}` : ''));
}

const coveredFrom = rows.length > 0 ? Number(rows[0].time) : windowFrom;
const folded = buildFuturesTradeRounds(fills, { income: deskEntries, incomeFrom: coveredFrom });
const closed = folded.filter(round => !round.open && round.exitPrice !== null);
say(`\nCLOSED ROUNDS: ${closed.length} (of ${folded.length} folded)`);
say('  income coverage starts', at(coveredFrom));

for (const round of closed) {
    const fee = (round.feesByAsset ?? []).map(f => `${usdt(f.amount)} ${f.asset}`).join(' + ') || '0';
    say(`\n  ${round.symbol} ${round.positionSide} qty=${round.quantity}`);
    say(`    opened ${at(round.openTime)}  closed ${at(round.closeTime)}  fills=${round.fills}`);
    say(`    entry ${round.entryPrice === null ? '—' : round.entryPrice}${round.entryImplied ? ' (implied)' : ''}`
        + `  exit ${round.exitPrice}`);
    say(`    realized ${usdt(round.realizedPnl)}`);
    say(`    commission ${fee}  (counted against the result: ${usdt(round.fee)} USDT)`);
    say(`    funding ${round.funding === null ? 'NOT READ' : usdt(round.funding)}`
        + `${round.fundingShared ? ' (shared — both legs open)' : ''}`);
    say(`    insurance ${round.insuranceClear === null ? 'NOT READ' : usdt(round.insuranceClear)}`);
    say(`    NET: ${usdt(round.netPnl)}`
        + `   [partial=${round.partial === true} fundingComplete=${round.fundingComplete}]`);
    // What the income record itself holds against this contract across the
    // round's own span, independent of how the fold attached it.
    const span = deskEntries.filter(e => e.symbol === round.symbol
        && e.time >= round.openTime && e.time <= round.closeTime);
    const byComponent = {};
    for (const entry of span) byComponent[entry.component] = (byComponent[entry.component] ?? 0) + entry.amount;
    say(`    income rows inside the round's span: ${span.length} — `
        + (Object.entries(byComponent).map(([k, v]) => `${k} ${usdt(v)}`).join(' | ') || 'none'));
}
