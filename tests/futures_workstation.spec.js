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
    await expect(identity).toContainText('PUBLIC MARKET DATA · READ ONLY');
    await expect(identity).toContainText('LIVE');
    return identity;
};

test('blue Testnet workstation is complete, interactive, bounded and responsive', async ({ browserName: _browserName }, testInfo) => {
    const { electronApp, mainWindow } = await launchWorkstation();

    try {
        await mainWindow.getByTestId('market-mode-futures-testnet').click();
        const identity = await waitForLiveWorkstation(
            mainWindow,
            'USDⓈ-M TESTNET · SIMULATED FUNDS',
        );
        await expect(mainWindow.getByLabel('USDⓈ-M contract selector')).toBeVisible();
        await expect(mainWindow.getByLabel('Exact contract filters')).toContainText('tickSize');
        await expect(mainWindow.getByLabel('Futures market header')).toContainText('Basis');
        await expect(mainWindow.locator('.futures-workstation-chart-canvas')).toBeVisible();
        await expect(mainWindow.locator('.futures-workstation-depth')).toContainText('Snapshot + diff');
        await expect(mainWindow.locator('.futures-workstation-trades')).toContainText('Bounded tape');

        const testnetLast = await mainWindow.getByText('Last', { exact: true })
            .locator('..')
            .locator('dd')
            .textContent();
        expect(testnetLast).toMatch(/^\d+(?:\.\d+)?$/);

        const intervals = mainWindow.getByRole('group', { name: 'Chart interval' });
        await intervals.getByRole('button', { name: '5m', exact: true }).click();
        await expect(intervals.getByRole('button', { name: '5m', exact: true })).toHaveAttribute(
            'aria-pressed',
            'true',
        );

        const search = mainWindow.getByLabel('Search Futures contracts');
        await search.fill('ETH');
        await search.press('Enter');
        await expect(mainWindow.getByLabel('Futures market header')).toContainText('BTCUSDT');
        const ownerBeforeSwitch = await identity.locator('code').textContent();
        await mainWindow.getByRole('button', { name: /^ETHUSDT/ }).click();
        await expect(mainWindow.getByLabel('Futures market header')).toContainText('ETHUSDT');
        await expect(identity.locator('code')).not.toHaveText(ownerBeforeSwitch);
        await expect(identity).toContainText('LIVE');

        const ask = mainWindow.locator('.futures-workstation-book-side.is-ask button').first();
        const pickedPrice = await ask.locator('span').first().textContent();
        await ask.click();
        const draft = mainWindow.getByLabel('Local non-executable price draft');
        await expect(draft).toContainText(pickedPrice);
        await expect(draft).toContainText('DISPLAY ONLY · NO INTENT · NO SUBMIT');
        await expect(mainWindow.getByLabel('Backend production intent')).toHaveCount(0);

        const workstationStorage = await mainWindow.evaluate(() => (
            Object.keys(window.localStorage).filter(key => /futures.*workstation/i.test(key))
        ));
        expect(workstationStorage).toEqual([]);
        await attachScreenshot(mainWindow, testInfo, 'blue-testnet-desktop');

        await mainWindow.setViewportSize({ width: 540, height: 760 });
        await expect(identity).toBeInViewport();
        await expect(identity).toContainText('TESTNET');
        const columns = await mainWindow.locator('.futures-workstation').evaluate(
            element => getComputedStyle(element).gridTemplateColumns,
        );
        expect(columns.trim().split(/\s+/)).toHaveLength(1);
        const hasHorizontalOverflow = await mainWindow.evaluate(() => (
            document.documentElement.scrollWidth > document.documentElement.clientWidth
        ));
        expect(hasHorizontalOverflow).toBe(false);
        await attachScreenshot(mainWindow, testInfo, 'blue-testnet-narrow');
    } finally {
        await electronApp.close();
    }
});

test('red Production workstation remains isolated and market widgets have no execution action', async ({ browserName: _browserName }, testInfo) => {
    const { electronApp, mainWindow } = await launchWorkstation();

    try {
        await mainWindow.getByTestId('market-mode-futures-testnet').click();
        await waitForLiveWorkstation(mainWindow, 'USDⓈ-M TESTNET · SIMULATED FUNDS');
        const testnetLast = await mainWindow.getByText('Last', { exact: true })
            .locator('..')
            .locator('dd')
            .textContent();

        await mainWindow.getByTestId('market-mode-futures-live').click();
        const identity = await waitForLiveWorkstation(
            mainWindow,
            'USDⓈ-M PRODUCTION · REAL MONEY',
        );
        const accent = await mainWindow.getByTestId('futures-production-workstation').evaluate(
            element => getComputedStyle(element).getPropertyValue('--futures-accent').trim(),
        );
        expect(accent).toBe('#e34f5e');
        await expect(mainWindow.getByLabel('USDⓈ-M production real-order execution')).toBeVisible();
        await expect(mainWindow.locator('.futures-workstation-safety-drawer summary')).toContainText(
            '1x · 10 USDT/order · 50 USDT/day',
        );
        await expect(mainWindow.getByLabel('USDⓈ-M testnet reduce-only execution')).toHaveCount(0);
        await expect(mainWindow.getByLabel('USDⓈ-M futures read-only risk')).toHaveCount(0);

        const productionLast = await mainWindow.getByText('Last', { exact: true })
            .locator('..')
            .locator('dd')
            .textContent();
        expect(productionLast).not.toBe(testnetLast);

        const marketActionNames = await mainWindow.locator('.futures-workstation button').evaluateAll(
            buttons => buttons.map(button => button.textContent?.trim() ?? ''),
        );
        expect(marketActionNames.join('\n')).not.toMatch(
            /place|submit|cancel all|close positions|kill switch|prepare.*intent/i,
        );

        const search = mainWindow.getByLabel('Search Futures contracts');
        await search.fill('ETH');
        await search.press('Enter');
        await expect(mainWindow.getByLabel('Futures market header')).toContainText('BTCUSDT');
        await expect(mainWindow.getByLabel('Backend production intent')).toHaveCount(0);

        const ask = mainWindow.locator('.futures-workstation-book-side.is-ask button').first();
        await ask.click();
        await expect(mainWindow.getByLabel('Local non-executable price draft')).toContainText(
            'DISPLAY ONLY · NO INTENT · NO SUBMIT',
        );
        await expect(mainWindow.getByLabel('Backend production intent')).toHaveCount(0);
        await attachScreenshot(mainWindow, testInfo, 'red-production-desktop');

        await mainWindow.setViewportSize({ width: 540, height: 760 });
        await expect(identity).toBeInViewport();
        await expect(identity).toContainText('PRODUCTION · REAL MONEY');
        const hasHorizontalOverflow = await mainWindow.evaluate(() => (
            document.documentElement.scrollWidth > document.documentElement.clientWidth
        ));
        expect(hasHorizontalOverflow).toBe(false);
        await attachScreenshot(mainWindow, testInfo, 'red-production-narrow');
    } finally {
        await electronApp.close();
    }
});
