import http from 'node:http';
import https from 'node:https';
import { afterEach, describe, expect, it } from 'vitest';
import {
    FuturesWorkstationNodeNetworkEscapeError,
    installFuturesWorkstationNodeNetworkEscapeGuard,
} from './futures-workstation-node-network-guard.js';

let activeGuard = null;

afterEach(() => {
    activeGuard?.restore();
    activeGuard = null;
});

describe('fail-fast Node Futures network tripwire', () => {
    it.each([
        ['https', () => https.request('https://fapi.binance.com/fapi/v1/depth')],
        ['wss handshake', () => https.request('https://fstream.binance.com/public/stream')],
        ['Testnet HTTPS', () => https.get('https://demo-fapi.binance.com/fapi/v1/klines')],
        ['Testnet WSS handshake', () => https.request({ hostname: 'demo-fstream.binance.com' })],
        ['plain HTTP downgrade', () => http.request('http://fapi.binance.com/fapi/v1/depth')],
    ])('throws synchronously before %s dispatch', (_label, attempt) => {
        activeGuard = installFuturesWorkstationNodeNetworkEscapeGuard();
        expect(attempt).toThrow(FuturesWorkstationNodeNetworkEscapeError);
        expect(activeGuard.getAttempts()).toHaveLength(1);
    });

    it('restores the original Node request functions', () => {
        const original = https.request;
        activeGuard = installFuturesWorkstationNodeNetworkEscapeGuard();
        expect(https.request).not.toBe(original);
        activeGuard.restore();
        activeGuard = null;
        expect(https.request).toBe(original);
    });
});
