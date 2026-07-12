import { _electron as electron, expect, test } from '@playwright/test';
import path from 'path';
import { waitForAppWindow } from './helpers/electronAppWindow.js';
import { reloadWithE2eLocalStorage } from './helpers/e2eLocalStorage.js';

test('switches between unchanged spot and the minimal mock futures read-only panel', async () => {
    const electronApp = await electron.launch({
        args: [path.join(process.cwd(), 'dist-electron/main.js')],
    });

    try {
        const mainWindow = await waitForAppWindow(electronApp);
        await reloadWithE2eLocalStorage(mainWindow);

        const spotMode = mainWindow.getByTestId('market-mode-spot');
        const futuresMode = mainWindow.getByTestId('market-mode-futures');
        await expect(spotMode).toHaveAttribute('aria-pressed', 'true');
        await expect(futuresMode).toContainText('MOCK');
        await expect(mainWindow.locator('.order-book')).toBeVisible();

        await futuresMode.click();

        const panel = mainWindow.getByLabel('USDⓈ-M futures read-only risk');
        await expect(panel).toBeVisible();
        await expect(panel).toContainText('USDⓈ-M READ ONLY');
        await expect(panel).toContainText('MOCK');
        await expect(panel).toContainText('BTCUSDT');
        await expect(panel).toContainText('Unrealized PnL');
        await expect(panel).toContainText('Liquidation');

        await expect(mainWindow.locator('.order-book')).toHaveCount(0);
        await expect(mainWindow.locator('.info-panel')).toHaveCount(0);
        await expect(mainWindow.locator('.trades-panel')).toHaveCount(0);
        await expect(mainWindow.locator('.chart-with-rsi-container')).toHaveCount(0);
        await expect(mainWindow.locator('.order-form-modal')).toHaveCount(0);
        await expect(panel.locator('button')).toHaveCount(0);

        await mainWindow.keyboard.press('B');
        await expect(mainWindow.locator('.quick-switch-modal')).toHaveCount(0);

        await spotMode.click();

        await expect(spotMode).toHaveAttribute('aria-pressed', 'true');
        await expect(mainWindow.getByTestId('futures-readonly-view')).toHaveCount(0);
        await expect(mainWindow.locator('.order-book')).toBeVisible();
        await expect(mainWindow.locator('.info-panel')).toBeVisible();

        await mainWindow.keyboard.press('B');
        await expect(mainWindow.locator('.quick-switch-modal')).toBeVisible();
        await mainWindow.keyboard.press('Escape');
        await expect(mainWindow.locator('.quick-switch-modal')).toHaveCount(0);
    } finally {
        await electronApp.close();
    }
});
