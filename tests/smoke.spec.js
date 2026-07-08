import { _electron as electron, test, expect } from '@playwright/test';
import path from 'path';
import { waitForAppWindow } from './helpers/electronAppWindow.js';
import { reloadWithE2eLocalStorage } from './helpers/e2eLocalStorage.js';

test('app launches', async () => {
    const electronApp = await electron.launch({
        args: [path.join(process.cwd(), 'dist-electron/main.js')],
    });

    const mainWindow = await waitForAppWindow(electronApp);
    await reloadWithE2eLocalStorage(mainWindow);

    console.log('Waiting for title "CC-trade" on window:', await mainWindow.title());
    // Wait for title to be correct (in case it's loading)
    await mainWindow.waitForFunction(() => document.title === 'CC-trade', null, { timeout: 5000 });
    expect(await mainWindow.title()).toBe('CC-trade');

    await electronApp.close();
});
