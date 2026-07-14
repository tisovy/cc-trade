import { _electron as electron, expect, test } from '@playwright/test';
import path from 'path';
import { waitForAppWindow } from './helpers/electronAppWindow.js';
import { reloadWithE2eLocalStorage } from './helpers/e2eLocalStorage.js';

test('switches between isolated spot, blue testnet, and red production workspaces', async () => {
    const electronApp = await electron.launch({
        args: [path.join(process.cwd(), 'dist-electron/main.js')],
    });

    try {
        const mainWindow = await waitForAppWindow(electronApp);
        await reloadWithE2eLocalStorage(mainWindow);

        const spotMode = mainWindow.getByTestId('market-mode-spot');
        const testnetMode = mainWindow.getByTestId('market-mode-futures-testnet');
        const liveMode = mainWindow.getByTestId('market-mode-futures-live');
        await expect(spotMode).toHaveAttribute('aria-pressed', 'true');
        await expect(testnetMode).toContainText('Futures Testnet');
        await expect(liveMode).toContainText('Futures Live');
        await expect(mainWindow.locator('.order-book')).toBeVisible();

        await testnetMode.click();

        await expect(testnetMode).toHaveAttribute('aria-pressed', 'true');
        await expect(mainWindow.getByTestId('futures-testnet-banner')).toHaveCSS(
            'background-color',
            'rgb(16, 68, 117)',
        );

        const panel = mainWindow.getByLabel('USDⓈ-M futures read-only risk');
        const testnetTicket = mainWindow.getByLabel('USDⓈ-M testnet reduce-only execution');
        await expect(panel).toBeVisible();
        await expect(testnetTicket).toHaveCSS('background-color', 'rgb(11, 23, 35)');
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

        await liveMode.click();

        await expect(liveMode).toHaveAttribute('aria-pressed', 'true');
        await expect(mainWindow.getByTestId('futures-live-banner')).toContainText(
            'REAL MONEY · PRODUCTION',
        );
        await expect(mainWindow.getByTestId('futures-live-banner')).toHaveCSS(
            'background-color',
            'rgb(115, 28, 37)',
        );
        const productionTicket = mainWindow.getByLabel('USDⓈ-M production real-order execution');
        await expect(productionTicket).toBeVisible();
        await expect(productionTicket).toHaveCSS('background-color', 'rgb(24, 11, 11)');
        await expect(mainWindow.getByLabel('USDⓈ-M futures read-only risk')).toHaveCount(0);
        await expect(mainWindow.getByLabel('USDⓈ-M testnet reduce-only execution')).toHaveCount(0);
        await expect(mainWindow.locator('.order-book')).toHaveCount(0);

        await mainWindow.keyboard.press('B');
        await expect(mainWindow.locator('.quick-switch-modal')).toHaveCount(0);

        await spotMode.click();

        await expect(spotMode).toHaveAttribute('aria-pressed', 'true');
        await expect(mainWindow.getByTestId('futures-testnet-view')).toHaveCount(0);
        await expect(mainWindow.getByTestId('futures-live-view')).toHaveCount(0);
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
