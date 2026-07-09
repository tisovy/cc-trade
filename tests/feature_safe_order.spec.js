import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { WebSocketServer } from 'ws';
import { waitForAppWindow } from './helpers/electronAppWindow.js';
import { reloadWithE2eLocalStorage } from './helpers/e2eLocalStorage.js';
import {
    attachMockWebSocketHandlers,
    createMockMarketState,
} from './helpers/mockWebSocketMessages.js';

test.describe('Feature: Safe Order Reduction', () => {
    let electronApp;
    let mainWindow;
    let wss;
    let lastOrder;
    const MOCK_PORT = 54323;

    test.beforeAll(async () => {
        wss = new WebSocketServer({ port: MOCK_PORT });
        const marketState = createMockMarketState({
            balances: { 'USDT': { available: '2000000.00', onOrder: '0.00' } },
            filters: { 'BTCUSDT': { tickSize: '0.01', stepSize: '0.000001', quantityPrecision: 6 } },
            ticker: [{ symbol: 'BTCUSDT', lastPrice: '50000.00', priceChangePercent: '1.5', quoteVolume: '100000000' }],
            depth: {
                bids: { '12345.00': '1.0' },
                asks: { '12346.00': '1.0' },
            },
        });

        wss.on('connection', (ws) => {
            const captureOrder = (payload, mockWs) => {
                const orderPayload = payload.data || payload;
                lastOrder = orderPayload;
                // Echo back the received quantity for verification
                mockWs.sendJson({
                    test_echo: {
                        quantity: orderPayload.quantity,
                        price: orderPayload.price
                    }
                });
            };

            attachMockWebSocketHandlers(ws, marketState, {
                onTypedOrder: captureOrder,
                onLegacyOrder: captureOrder,
            });
        });

        electronApp = await electron.launch({
            args: [path.join(process.cwd(), 'dist-electron/main.e2e.js')],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                MOCK_WS_URL: `ws://localhost:${MOCK_PORT}`,
                BK: '',
                BS: '',
            },
        });

        mainWindow = await waitForAppWindow(electronApp);
        await reloadWithE2eLocalStorage(mainWindow, {
            mockWsUrl: `ws://localhost:${MOCK_PORT}`,
            selected: 'BTCUSDT',
            interval: '1h',
        });
    });

    test.afterAll(async () => {
        if (wss) wss.close();
        if (electronApp) await electronApp.close();
    });

    test('should reduce order quantity by 0.1%', async () => {
        await mainWindow.keyboard.press('Escape');
        await expect(mainWindow.locator('.quick-switch-backdrop')).toBeHidden();

        // 1. Open Order Modal via OrderBook
        const askRow = mainWindow.locator('.order-book .feed .ob-sell .columns').first();
        await expect(askRow).toBeVisible();
        await askRow.dblclick();

        // 2. Fill and Submit Order
        const modal = mainWindow.locator('.order-form-modal .modal-content');
        await expect(modal).toBeVisible();
        await mainWindow.waitForTimeout(1000);

        const amountInput = modal.locator('input#formAmount');
        await amountInput.fill('100'); // Input 100

        const buyButton = modal.locator('[data-testid="submit-order-btn"]');

        lastOrder = null;

        await buyButton.click();

        // Wait for order to be received by mock server
        await expect.poll(() => lastOrder).toBeTruthy();

        // 3. Verify Quantity Reduction
        // Input: 100
        // Expected: 100 * 0.999 = 99.9
        expect(lastOrder.quantity).toBe('99.9');
    });
});
