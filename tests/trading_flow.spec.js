import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import { WebSocketServer } from 'ws';
import { waitForAppWindow } from './helpers/electronAppWindow.js';
import { reloadWithE2eLocalStorage } from './helpers/e2eLocalStorage.js';

test.describe('Trading Flow (Mocked)', () => {
    let electronApp;
    let mainWindow;
    let wss;
    const MOCK_PORT = 54321;

    test.beforeAll(async () => {
        // 1. Start Mock WebSocket Server
        wss = new WebSocketServer({ port: MOCK_PORT });
        wss.on('connection', (ws) => {
            console.log('Mock WS Connected');

            // Send Initial State immediately on connection
            ws.send(JSON.stringify({
                balances: { 'USDT': { available: '2000.00', onOrder: '0.00' }, 'BTC': { available: '0.5', onOrder: '0.0' } },
                orders: [],
                filters: { 'BTCUSDT': { tickSize: '0.01', stepSize: '0.000001', minQty: '0.000001', minNotional: '10' } },
                ticker: [{ symbol: 'BTCUSDT', lastPrice: '50000.00' }]
            }));

            // Send Depth
            ws.send(JSON.stringify({
                depth: {
                    bids: { '12345.00': '1.0', '12344.00': '2.0' },
                    asks: { '12346.00': '1.0', '12347.00': '2.0' }
                },
                symbol: 'BTCUSDT'
            }));

            // Send Chart Data
            ws.send(JSON.stringify({
                chart: [
                    { time: Date.now() - 60000, open: '49900', high: '50100', low: '49800', close: '50000', volume: '10' },
                    { time: Date.now(), open: '50000', high: '50200', low: '49900', close: '50100', volume: '5' }
                ],
                symbol: 'BTCUSDT',
                interval: '1h'
            }));

            ws.on('message', (message) => {
                const payload = JSON.parse(message);
                console.log('Received:', payload);

                if (payload.request === 'buyOrder') {
                    // App reduces quantity by 0.1% (0.1 -> 0.0999)
                    // Price comes from ASK row (12346)
                    if (payload.data.price === '12346' && (payload.data.quantity === '0.1' || payload.data.quantity === '0.0999')) {
                        // Send Execution Report (NEW)
                        ws.send(JSON.stringify({
                            execution_update: {
                                e: 'executionReport',
                                s: 'BTCUSDT',
                                S: 'BUY',
                                o: 'LIMIT',
                                x: 'NEW',
                                X: 'NEW',
                                i: 12345,
                                p: '12346',
                                q: '0.0999',
                                z: '0.0',
                                T: Date.now()
                            }
                        }));
                        // Update Orders List
                        ws.send(JSON.stringify({
                            orders: [{
                                symbol: 'BTCUSDT',
                                orderId: 12345,
                                price: '12346',
                                origQty: '0.0999',
                                side: 'BUY',
                                type: 'LIMIT',
                                status: 'NEW',
                                time: Date.now()
                            }]
                        }));
                    }
                }

                if (payload.request === 'cancelOrder') {
                    // Send Execution Report (CANCELED)
                    ws.send(JSON.stringify({
                        execution_update: {
                            e: 'executionReport',
                            s: 'BTCUSDT',
                            S: 'BUY',
                            o: 'LIMIT',
                            x: 'CANCELED',
                            X: 'CANCELED',
                            i: 12345,
                            p: '12345',
                            q: '0.1',
                            z: '0.0',
                            T: Date.now()
                        }
                    }));
                    // Update Orders List (Empty)
                    ws.send(JSON.stringify({
                        orders: []
                    }));
                }
            });
        });

        // 2. Launch Electron
        electronApp = await electron.launch({
            args: [path.join(process.cwd(), 'dist-electron/main.e2e.js')],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                MOCK_WS_URL: `ws://localhost:${MOCK_PORT}`,
                BK: '', // Disable Live Binance Connection
                BS: '', // Disable Live Binance Connection
            },
        });

        mainWindow = await waitForAppWindow(electronApp, { pollInterval: 500 });
        await reloadWithE2eLocalStorage(mainWindow, {
            mockWsUrl: `ws://localhost:${MOCK_PORT}`,
            selected: 'BTCUSDT',
            interval: '1h',
        });
        await expect(mainWindow).toHaveTitle('CC-trade');

        mainWindow.on('console', msg => console.log('PAGE LOG:', msg.text()));
        mainWindow.on('pageerror', err => console.log('PAGE ERROR:', err));

        electronApp.process().stdout.on('data', (data) => {
            console.log(`MAIN LOG: ${data}`);
        });
        electronApp.process().stderr.on('data', (data) => {
            console.error(`MAIN ERR: ${data}`);
        });
    });

    test.afterAll(async () => {
        if (wss) wss.close();
        if (electronApp) await electronApp.close();
    });

    test('should place and cancel an order', async () => {
        // 1. Open Order Form via OrderBook
        // Click ASK row to trigger BUY order
        const askRow = mainWindow.locator('.ob .ob-sell .item').first();
        await expect(askRow).toBeVisible();
        await askRow.dblclick();

        // 2. Fill and Submit Order
        const modal = mainWindow.locator('.modal-content');
        await expect(modal).toBeVisible();

        // Wait for animation/render
        await mainWindow.waitForTimeout(1000);

        const amountInput = modal.locator('#formAmount');
        await amountInput.fill('0.1');

        const buyButton = modal.locator('[data-testid="submit-order-btn"]');
        await buyButton.click();

        await expect(modal).toBeHidden();

        // 3. Verify Order in InfoPanel
        const ordersTab = mainWindow.locator('#orders');
        await ordersTab.click();

        const orderRow = mainWindow.locator('.order-card', { hasText: '12346' });
        await expect(orderRow).toBeVisible();

        // 4. Cancel Order
        const cancelBtn = orderRow.locator('.order-card-cancel');
        await cancelBtn.click();

        // 5. Verify Order Removed
        await expect(orderRow).toBeHidden();
    });
});
