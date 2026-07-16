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

test('red Production workstation remains isolated and market widgets have no execution action', async ({ browserName: _browserName }, testInfo) => {
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
        await expect(mainWindow.getByLabel('USDⓈ-M production real-order execution')).toBeVisible();
        await expect(mainWindow.locator('.futures-workstation-safety-drawer summary')).toContainText(
            '1x · 10 USDT/order · 50 USDT/day',
        );
        const productionLast = await mainWindow.getByText('Last', { exact: true })
            .locator('..')
            .locator('dd')
            .textContent();
        expect(productionLast).toMatch(/^\d+(?:\.\d+)?$/);

        await mainWindow.locator('.futures-production-workstation')
            .getByRole('button', { name: '5m', exact: true })
            .click();
        await expect(identity).toContainText('LIVE');
        await expect(identity.locator('code')).toContainText('gen 2');
        await expect(mainWindow.locator('.futures-production-workstation')
            .getByRole('button', { name: '5m', exact: true }))
            .toHaveAttribute('aria-pressed', 'true');

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
        const draft = mainWindow.getByLabel('Local non-executable price draft');
        await expect(draft).toContainText(
            'DISPLAY ONLY · NO INTENT · NO SUBMIT',
        );
        await expect(mainWindow.getByLabel('Backend production intent')).toHaveCount(0);
        const ownerBeforeSymbolSwitch = await identity.locator('code').textContent();
        await mainWindow.getByRole('button', { name: /^ETHUSDT/ }).click();
        await expect(mainWindow.getByLabel('Futures market header')).toContainText('ETHUSDT');
        await expect(identity).toContainText('LIVE');
        await expect(identity.locator('code')).not.toHaveText(ownerBeforeSymbolSwitch);
        await expect(draft).toContainText('Pick chart or book price');
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
