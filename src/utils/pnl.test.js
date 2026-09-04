import { beforeEach, describe, expect, it } from 'vitest';
import { calculatePnL, loadPnLData, resetPnL, incrementTradeCount, takeSnapshot, getTimeRangeLabel } from './pnl.js';
import { readSpotAccountStorage, writeSpotAccountStorage } from './spotAccountScope.js';

const A = 'a'.repeat(64), B = 'b'.repeat(64);
const ticker = [{ symbol: 'BTCUSDT', lastPrice: '50000' }];
const balances = value => ({ USDT: { available: String(value), onOrder: '0' } });
beforeEach(() => localStorage.clear());

describe('account-owned Spot PnL', () => {
    it('never compares B=1000 to A=10000 or an unattributed legacy baseline', () => {
        const legacy = JSON.stringify({ snapshots: { all: { timestamp: Date.now(), totalUSDT: 10000 } } });
        localStorage.setItem('pnl_snapshots', legacy);
        expect(calculatePnL('all', balances(10000), ticker, A).pnl).toBe(0);
        expect(calculatePnL('all', balances(1000), ticker, B)).toMatchObject({ hasSnapshot: true, startValue: 1000, pnl: 0, pnlPercent: 0 });
        expect(calculatePnL('all', balances(11000), ticker, A)).toMatchObject({ startValue: 10000, pnl: 1000, pnlPercent: 10 });
        expect(localStorage.getItem('pnl_snapshots')).toBe(legacy);
    });
    it('isolates manual reset and trade counts', () => {
        calculatePnL('all', balances(10000), ticker, A);
        calculatePnL('all', balances(1000), ticker, B);
        incrementTradeCount(A);
        resetPnL('all', balances(12000), ticker, A);
        expect(loadPnLData(A).snapshots.all.totalUSDT).toBe(12000);
        expect(loadPnLData(B).snapshots.all.totalUSDT).toBe(1000);
        expect(loadPnLData(B).tradesSince.day).toBe(0);
        expect(loadPnLData(A).tradesSince.day).toBe(1);
    });
    it.each([null, undefined, 'invalid'])('does not anchor or persist before identity %j', fp => {
        expect(calculatePnL('all', balances(1000), ticker, fp).hasSnapshot).toBe(false);
        resetPnL('all', balances(1000), ticker, fp);
        takeSnapshot('all', balances(1000), ticker, null, fp);
        incrementTradeCount(fp);
        expect(localStorage.length).toBe(0);
    });
    it('retains price-readiness and incomplete balance protection', () => {
        expect(calculatePnL('all', balances(1000), [], A).hasSnapshot).toBe(false);
        expect(calculatePnL('all', {}, ticker, A).hasSnapshot).toBe(false);
        expect(readSpotAccountStorage('pnl_snapshots', A)).toBeNull();
        calculatePnL('all', balances(1000), ticker, A);
        expect(calculatePnL('all', {}, ticker, A)).toMatchObject({ hasSnapshot: true, pnl: 0, currentValue: 1000 });
        resetPnL('all', balances(1000), [], A);
        expect(loadPnLData(A).snapshots.all.totalBTC).toBe(0.02);
    });
    it('ignores malformed scoped snapshots and trade counters', () => {
        writeSpotAccountStorage('pnl_snapshots', A, { snapshots: { all: { timestamp: 1, totalUSDT: '10000', totalBTC: 1, btcPrice: 50000 } }, tradesSince: { day: -5 } });
        expect(loadPnLData(A).snapshots.all).toBeNull();
        expect(loadPnLData(A).tradesSince.day).toBe(0);
        expect(calculatePnL('all', balances(1000), ticker, A).pnl).toBe(0);
    });
    it('refreshes stale calendar snapshots only for their owner', () => {
        calculatePnL('day', balances(1000), ticker, A);
        const held = loadPnLData(A);
        held.snapshots.day.timestamp = new Date(2000, 0, 1).getTime();
        writeSpotAccountStorage('pnl_snapshots', A, held);
        expect(calculatePnL('day', balances(2000), ticker, A)).toMatchObject({ startValue: 2000, pnl: 0 });
        expect(getTimeRangeLabel('day', null, A)).toContain('Since');
        expect(getTimeRangeLabel('day', null, B)).toBe('Today (no snapshot)');
    });
});
