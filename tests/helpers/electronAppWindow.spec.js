import { test, expect } from '@playwright/test';
import { isDevToolsWindow, waitForAppWindow } from './electronAppWindow.js';

const createWindowPage = ({ title, url }) => ({
    title: async () => title,
    url: () => url,
});

const createElectronApp = (windows) => ({
    windows: async () => windows,
});

test.describe('waitForAppWindow', () => {
    test('skips DevTools windows and returns the app window', async () => {
        const devToolsWindow = createWindowPage({
            title: 'DevTools',
            url: 'devtools://devtools/bundled/inspector.html',
        });
        const appWindow = createWindowPage({
            title: 'CC-trade',
            url: 'file:///app/dist/index.html',
        });

        expect(await isDevToolsWindow(devToolsWindow)).toBe(true);
        expect(await waitForAppWindow(createElectronApp([devToolsWindow, appWindow]))).toBe(appWindow);
    });

    test('falls back to a loading app window without returning DevTools', async () => {
        const devToolsWindow = createWindowPage({
            title: 'Developer Tools - CC-trade',
            url: 'devtools://devtools/bundled/inspector.html',
        });
        const loadingAppWindow = createWindowPage({
            title: '',
            url: 'file:///app/dist/index.html',
        });

        const selectedWindow = await waitForAppWindow(
            createElectronApp([devToolsWindow, loadingAppWindow]),
            { timeout: 1, pollInterval: 1 },
        );

        expect(selectedWindow).toBe(loadingAppWindow);
    });

    test('fails instead of returning DevTools when no app window exists', async () => {
        const devToolsWindow = createWindowPage({
            title: 'DevTools',
            url: 'devtools://devtools/bundled/inspector.html',
        });

        await expect(
            waitForAppWindow(createElectronApp([devToolsWindow]), { timeout: 1, pollInterval: 1 }),
        ).rejects.toThrow('App window not found');
    });

    test('tolerates windows that fail url reads', async () => {
        const appWindow = {
            title: async () => 'CC-trade',
            url: () => {
                throw new Error('Page closed');
            },
        };

        expect(await waitForAppWindow(createElectronApp([appWindow]))).toBe(appWindow);
    });
});
