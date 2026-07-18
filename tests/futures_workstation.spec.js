import { _electron as electron, expect, test } from '@playwright/test';
import path from 'path';
import { reloadWithE2eLocalStorage } from './helpers/e2eLocalStorage.js';
import { waitForAppWindow } from './helpers/electronAppWindow.js';

const launchWorkstation = async () => {
    const electronApp = await electron.launch({
        args: [path.join(process.cwd(), 'dist-electron/main.js')],
    });
    const mainWindow = await waitForAppWindow(electronApp);
    await reloadWithE2eLocalStorage(mainWindow);
    return { electronApp, mainWindow };
};

const attachScreenshot = async (mainWindow, testInfo, name) => {
    const screenshot = await mainWindow.screenshot({ animations: 'disabled' });
    expect(screenshot.byteLength).toBeGreaterThan(10_000);
    await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
};

const waitForLiveWorkstation = async (mainWindow, identityText) => {
    const identity = mainWindow.getByTestId('futures-workstation-identity');
    await expect(identity).toContainText(identityText);
    await expect(identity).toContainText('PUBLIC MARKET DATA · LIVE EXECUTION');
    await expect(identity).toContainText('LIVE');
    return identity;
};

test('Futures Live is ready, keeps contracts visible and executes only mocked gestures', async ({ browserName: _browserName }, testInfo) => {
    const { electronApp, mainWindow } = await launchWorkstation();

    try {
        await expect(mainWindow.getByTestId('market-mode-futures-testnet')).toHaveCount(0);
        await mainWindow.getByTestId('market-mode-futures-live').click();
        const identity = await waitForLiveWorkstation(
            mainWindow,
            'USDⓈ-M PRODUCTION · REAL MONEY',
        );
        const accent = await mainWindow.getByTestId('futures-production-workstation').evaluate(
            element => getComputedStyle(element).getPropertyValue('--futures-accent').trim(),
        );
        expect(accent).toBe('#e34f5e');
        const tradingRail = mainWindow.getByLabel('USDⓈ-M production real-order execution');
        await expect(tradingRail).toBeVisible();
        await expect(tradingRail.getByRole('tab', { name: 'Trade' }))
            .toHaveAttribute('aria-selected', 'true');
        await expect(tradingRail.locator('.futures-production-readiness')).toContainText('READY');
        await expect(tradingRail.locator('.futures-production-readiness'))
            .toContainText('Gesture execution ready');
        await expect(tradingRail.getByRole('tab', { name: /^Orders 1$/ })).toBeVisible();
        await expect(mainWindow.getByText('Gesture trading', { exact: true })).toHaveCount(0);
        await expect(tradingRail.getByRole('button', {
            name: /Enter LONG|Exit LONG|Enter SHORT|Exit SHORT/i,
        })).toHaveCount(0);
        const sizeSlider = tradingRail.getByRole('slider', { name: 'Order size percent' });
        await expect(sizeSlider).toBeEnabled();
        await expect(mainWindow.locator('.futures-workstation-safety-drawer')).toHaveCount(0);
        await expect(mainWindow.locator('.futures-production-execution-header strong'))
            .toContainText('ISOLATED · 2× · HEDGE');
        const advancedSafety = mainWindow.locator('.futures-production-advanced-safety');
        await expect(advancedSafety.locator('summary')).toContainText('Advanced safety');
        await expect(advancedSafety).not.toHaveAttribute('open', '');
        const productionLast = await mainWindow.getByText('Last', { exact: true })
            .locator('..')
            .locator('dd')
            .textContent();
        expect(productionLast).toMatch(/^\d+(?:\.\d+)?$/);

        await tradingRail.getByRole('tab', { name: /^Orders 1$/ }).click();
        const currentOrders = tradingRail.getByLabel('Current Futures orders');
        await expect(currentOrders).toContainText('BTCUSDT');
        await expect(currentOrders).toContainText('BUY · LONG');
        await expect(currentOrders).toContainText('LIMIT');
        await expect(currentOrders).toContainText('58445.00');
        await expect(currentOrders).toContainText('NEW');
        await expect(currentOrders).toContainText('Original qty');
        await expect(currentOrders).toContainText('Filled qty');
        await expect(currentOrders).toContainText('0.004');
        await tradingRail.getByRole('tab', { name: 'Trade' }).click();

        const externalOrderLine = mainWindow.getByRole('button', {
            name: /Move LONG ENTRY order at 58445\.00 with Ctrl or Alt drag/,
        });
        await expect(externalOrderLine).toBeVisible();
        const lineBox = await externalOrderLine.boundingBox();
        expect(lineBox).not.toBeNull();
        await mainWindow.keyboard.down('Control');
        await mainWindow.mouse.move(
            lineBox.x + (lineBox.width / 2),
            lineBox.y + (lineBox.height / 2),
        );
        await mainWindow.mouse.down();
        await mainWindow.mouse.move(
            lineBox.x + (lineBox.width / 2),
            lineBox.y + (lineBox.height / 2) + 28,
            { steps: 4 },
        );
        await mainWindow.mouse.up();
        await mainWindow.keyboard.up('Control');
        await expect(externalOrderLine).toHaveCount(0);
        const movedExternalOrderLine = mainWindow.locator('.futures-workstation-owned-order');
        await expect(movedExternalOrderLine).toHaveCount(1);
        await expect(movedExternalOrderLine).toBeVisible();
        await expect(movedExternalOrderLine).not.toHaveAttribute('aria-label', /at 58445\.00/);
        await expect(tradingRail.getByRole('tab', { name: /^Orders 1$/ })).toBeVisible();

        const btcAsk = mainWindow.locator('.futures-workstation-book-side.is-ask button').first();
        await btcAsk.click();
        await sizeSlider.fill('100');
        await expect(tradingRail.locator('.futures-production-size-slider output'))
            .toContainText('100%');
        await expect(tradingRail.getByLabel('Order notional USDT')).toHaveValue('10');
        await expect(tradingRail.locator('.futures-production-draft-reason'))
            .toContainText('below the Binance minimum quantity');
        await expect(tradingRail.locator('.futures-production-order-summary'))
            .toContainText('Safe limit10 USDT');

        const contractList = mainWindow.locator('.futures-workstation-contract-list');
        await expect(contractList).toBeVisible();
        const initialContractListBox = await contractList.boundingBox();
        expect(initialContractListBox).not.toBeNull();
        expect(initialContractListBox.width).toBeGreaterThan(100);
        expect(initialContractListBox.height).toBeGreaterThan(100);
        const selectContract = symbol => contractList
            .locator('.futures-workstation-contract-select')
            .filter({ hasText: symbol });
        await selectContract('ETHUSDT').click();
        await expect(mainWindow.getByLabel('Futures market header')).toContainText('ETHUSDT');
        const ask = mainWindow.locator('.futures-workstation-book-side.is-ask button').first();
        await ask.click();
        await sizeSlider.fill('100');
        await expect(tradingRail.locator('.futures-production-size-slider output'))
            .toContainText('100%');
        await expect(tradingRail.getByLabel('Order notional USDT')).toHaveValue('10');
        const orderSummary = tradingRail.locator('.futures-production-order-summary');
        await expect(orderSummary).toContainText('Quantity');
        await expect(orderSummary).toContainText('Est. margin');
        expect(await orderSummary.textContent()).not.toMatch(/Quantity—|Est\. margin—/);

        await ask.dblclick({ modifiers: ['Alt'] });
        await expect(tradingRail.getByRole('tab', { name: /^Orders 1$/ })).toBeVisible();

        const generationBeforeInterval = Number(
            (await identity.locator('code').textContent())?.match(/^gen (\d+)/)?.[1],
        );
        await mainWindow.locator('.futures-production-workstation')
            .getByRole('button', { name: '5m', exact: true })
            .click();
        await expect(identity).toContainText('LIVE');
        await expect.poll(async () => Number(
            (await identity.locator('code').textContent())?.match(/^gen (\d+)/)?.[1],
        )).toBe(generationBeforeInterval + 1);
        await expect(mainWindow.locator('.futures-production-workstation')
            .getByRole('button', { name: '5m', exact: true }))
            .toHaveAttribute('aria-pressed', 'true');

        const marketActionNames = await mainWindow.locator([
            '.futures-workstation-market-header button',
            '.futures-workstation-chart button',
            '.futures-workstation-depth button',
            '.futures-workstation-trades button',
        ].join(', ')).evaluateAll(buttons => (
            buttons.map(button => button.textContent?.trim() ?? '')
        ));
        expect(marketActionNames.join('\n')).not.toMatch(
            /place|submit|cancel all|close positions|kill switch|prepare.*intent/i,
        );

        await expect(contractList.locator('.futures-workstation-contract')).toHaveCount(3);
        await contractList.evaluate((element) => {
            const samples = [];
            const record = () => samples.push(
                element.querySelectorAll('.futures-workstation-contract').length,
            );
            const observer = new MutationObserver(record);
            record();
            observer.observe(element, { childList: true, subtree: true });
            globalThis.__futuresContractsProbe = { samples, observer };
        });
        await selectContract('BTCUSDT').click();
        await selectContract('ETHUSDT').click();
        await selectContract('SOLUSDT').click();
        await expect(mainWindow.getByLabel('Futures market header')).toContainText('SOLUSDT');
        await expect(identity).toContainText('LIVE');
        await mainWindow.waitForTimeout(250);
        const contractSamples = await contractList.evaluate(() => {
            const probe = globalThis.__futuresContractsProbe;
            probe?.observer?.disconnect();
            delete globalThis.__futuresContractsProbe;
            return probe?.samples ?? [];
        });
        expect(contractSamples.length).toBeGreaterThan(0);
        expect(Math.min(...contractSamples)).toBeGreaterThan(0);
        const contractRows = contractList.locator('.futures-workstation-contract');
        await expect(contractRows).toHaveCount(3);
        expect(await contractRows.evaluateAll(rows => rows.map((row) => {
            const bounds = row.getBoundingClientRect();
            return bounds.width > 0 && bounds.height > 0;
        }))).toEqual([true, true, true]);
        await selectContract('BTCUSDT').click();
        await expect(mainWindow.getByLabel('Futures market header')).toContainText('BTCUSDT');

        const chart = mainWindow.getByTestId('futures-workstation-chart');
        await expect(chart).not.toContainText(/\bLIMIT\b/);
        await expect(mainWindow.locator('.futures-workstation-chart [aria-label*="LIMIT"]'))
            .toHaveCount(0);
        await attachScreenshot(mainWindow, testInfo, 'futures-ready-desktop');

        await mainWindow.setViewportSize({ width: 540, height: 760 });
        await expect(identity).toBeInViewport();
        await expect(identity).toContainText('PRODUCTION · REAL MONEY');
        const hasHorizontalOverflow = await mainWindow.evaluate(() => (
            document.documentElement.scrollWidth > document.documentElement.clientWidth
        ));
        expect(hasHorizontalOverflow).toBe(false);
        await attachScreenshot(mainWindow, testInfo, 'futures-ready-narrow');
    } finally {
        await electronApp.close();
    }
});

test('Ctrl and Alt double-right gestures bypass the native menu exactly once', async () => {
    const { electronApp, mainWindow } = await launchWorkstation();

    try {
        await mainWindow.getByTestId('market-mode-futures-live').click();
        await waitForLiveWorkstation(mainWindow, 'USDⓈ-M PRODUCTION · REAL MONEY');
        const tradingRail = mainWindow.getByLabel('USDⓈ-M production real-order execution');
        await expect(tradingRail.locator('.futures-production-readiness')).toContainText('READY');
        await electronApp.evaluate(({ BrowserWindow }) => {
            const [window] = BrowserWindow.getAllWindows();
            if (!window) throw new Error('Missing Futures E2E BrowserWindow');
            window.webContents.__futuresNativeContextMenuCount = 0;
            window.webContents.on('context-menu', () => {
                window.webContents.__futuresNativeContextMenuCount += 1;
            });
        });

        const chart = mainWindow.getByTestId('futures-workstation-chart');
        await chart.dblclick({
            button: 'right',
            modifiers: ['Alt'],
            position: { x: 220, y: 130 },
        });
        await expect(tradingRail.locator('.futures-production-ticket-symbol code'))
            .toHaveText('LONG exit');
        await expect(tradingRail.getByLabel('Exact limit price')).not.toHaveValue('');
        await expect(tradingRail.locator('.futures-production-order-summary'))
            .toContainText('LONG leg');

        const contractList = mainWindow.locator('.futures-workstation-contract-list');
        await contractList.locator('.futures-workstation-contract-select')
            .filter({ hasText: 'ETHUSDT' })
            .click();
        await expect(mainWindow.getByLabel('Futures market header')).toContainText('ETHUSDT');
        await expect(mainWindow.locator('.futures-workstation-chart-frame .futures-workstation-overlay'))
            .toHaveCount(0);
        const sizeSlider = tradingRail.getByRole('slider', { name: 'Order size percent' });
        await sizeSlider.fill('100');
        const bid = mainWindow.locator('.futures-workstation-book-side.is-bid button').first();
        await bid.dblclick({ button: 'right', modifiers: ['Control'] });
        await expect(tradingRail.locator('.futures-production-ticket-symbol code'))
            .toHaveText('SHORT entry');
        await expect(tradingRail.getByRole('tab', { name: /^Orders 1$/ })).toBeVisible();

        const nativeContextMenuCount = await electronApp.evaluate(({ BrowserWindow }) => {
            const [window] = BrowserWindow.getAllWindows();
            return window?.webContents.__futuresNativeContextMenuCount ?? -1;
        });
        expect(nativeContextMenuCount).toBe(0);
    } finally {
        await electronApp.close();
    }
});

test('Production workstation stream remains continuously LIVE', async () => {
    const { electronApp, mainWindow } = await launchWorkstation();

    try {
        for (const [modeTestId, identityText] of [
            ['market-mode-futures-live', 'USDⓈ-M PRODUCTION · REAL MONEY'],
        ]) {
            await mainWindow.getByTestId(modeTestId).click();
            const identity = await waitForLiveWorkstation(mainWindow, identityText);
            await identity.evaluate((element) => {
                const observations = [];
                const record = () => observations.push({
                    state: element.querySelector('[role="status"]')?.textContent?.trim() ?? '',
                    owner: element.querySelector('code')?.textContent?.trim() ?? '',
                });
                const observer = new MutationObserver(record);
                record();
                observer.observe(element, { childList: true, characterData: true, subtree: true });
                globalThis.__futuresWorkstationStabilityProbe = { observations, observer };
            });

            await mainWindow.waitForTimeout(6_000);
            const observations = await identity.evaluate(() => {
                const probe = globalThis.__futuresWorkstationStabilityProbe;
                probe?.observer?.disconnect();
                delete globalThis.__futuresWorkstationStabilityProbe;
                return probe?.observations ?? [];
            });
            expect([...new Set(observations.map(observation => observation.state))])
                .toEqual(['LIVE']);
            expect([...new Set(observations.map(observation => (
                observation.owner.match(/^gen (\d+)/)?.[1] ?? ''
            )))])
                .toEqual(['1']);
        }
    } finally {
        await electronApp.close();
    }
});
