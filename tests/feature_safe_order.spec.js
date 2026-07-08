import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { WebSocketServer } from 'ws';
import { waitForAppWindow } from './helpers/electronAppWindow.js';
import { reloadWithE2eLocalStorage } from './helpers/e2eLocalStorage.js';

test.describe('Feature: Safe Order Reduction', () => {
    let electronApp;
    let mainWindow;
    let wss;
    const MOCK_PORT = 54323;

    test.beforeAll(async () => {
        wss = new WebSocketServer({ port: MOCK_PORT });
        wss.on('connection', (ws) => {
            ws.send(JSON.stringify({
                balances: { 'USDT': { available: '2000000.00', onOrder: '0.00' } },
                orders: [],
                filters: { 'BTCUSDT': { tickSize: '0.01', stepSize: '0.000001', quantityPrecision: 6 } },
                ticker: [{ symbol: 'BTCUSDT', lastPrice: '50000.00' }]
            }));

            // Send Depth
            ws.send(JSON.stringify({
                depth: {
                    bids: { '12345.00': '1.0' },
                    asks: { '12346.00': '1.0' }
                },
                symbol: 'BTCUSDT'
            }));

            ws.on('message', (message) => {
                const payload = JSON.parse(message);
                if (payload.request === 'chart') {
                    ws.send(JSON.stringify({
                        type: 'chart',
                        payload: [
                            { time: Date.now() - 60000, open: 50000, high: 51000, low: 49000, close: 50500 },
                            { time: Date.now(), open: 50500, high: 51500, low: 50000, close: 51000 }
                        ],
                        meta: { symbol: 'BTCUSDT', interval: '1h' }
                    }));
                }
                if (payload.request === 'buyOrder') {
                    // Echo back the received quantity for verification
                    ws.send(JSON.stringify({
                        test_echo: {
                            quantity: payload.data.quantity,
                            price: payload.data.price
                        }
                    }));
                }
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

        // Note: Old echoPromise approach removed - using direct client listener below instead

        // Better approach: Capture console logs or just wait for a specific response if the app handles it.
        // But the app doesn't handle 'test_echo'.
        // So we need to intercept the request in the test or use the echo to verify.
        // Since we can't easily read the ws messages from the test process without a client,
        // let's rely on the mock server storing the last received order.

        let lastOrder = null;
        wss.clients.forEach(client => {
            client.on('message', msg => {
                const payload = JSON.parse(msg);
                if (payload.request === 'buyOrder') {
                    lastOrder = payload.data;
                }
            });
        });

        await buyButton.click();

        // Wait for order to be received by mock server
        await expect.poll(() => lastOrder).toBeTruthy();

        // 3. Verify Quantity Reduction
        // Input: 100
        // Expected: 100 * 0.999 = 99.9
        expect(lastOrder.quantity).toBe('99.9');
    });
});
