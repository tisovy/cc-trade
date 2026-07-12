import { _electron as electron, expect, test } from '@playwright/test';
import path from 'path';
import { waitForAppWindow } from './helpers/electronAppWindow.js';
import { reloadWithE2eLocalStorage } from './helpers/e2eLocalStorage.js';

test('uses a sandboxed renderer with only the narrow runtime bridge', async () => {
    const electronApp = await electron.launch({
        args: [path.join(process.cwd(), 'dist-electron/main.js')],
    });

    try {
        const mainWindow = await waitForAppWindow(electronApp);
        expect(mainWindow.url()).toBe('cc-trade://renderer/index.html');
        await reloadWithE2eLocalStorage(mainWindow);
        await expect.poll(() => mainWindow.evaluate(() => ({
            currentView: localStorage.getItem('currentView'),
            hasOrderBook: Boolean(document.querySelector('.order-book')),
        }))).toEqual({ currentView: 'depth', hasOrderBook: true });
        const preferences = await electronApp.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            const webPreferences = window.webContents.getLastWebPreferences();
            return {
                nodeIntegration: webPreferences.nodeIntegration,
                contextIsolation: webPreferences.contextIsolation,
                sandbox: webPreferences.sandbox,
                webSecurity: webPreferences.webSecurity,
                allowRunningInsecureContent: webPreferences.allowRunningInsecureContent,
                webviewTag: webPreferences.webviewTag,
            };
        });

        expect(preferences).toEqual({
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            webviewTag: false,
        });

        const rendererBoundary = await mainWindow.evaluate(() => ({
            process: typeof globalThis.process,
            require: typeof globalThis.require,
            buffer: typeof globalThis.Buffer,
            electron: typeof globalThis.electron,
            runtimeKeys: Object.keys(globalThis.ccTradeRuntime || {}).sort(),
            runtimeValueTypes: Object.fromEntries(
                Object.entries(globalThis.ccTradeRuntime || {}).map(([key, value]) => [key, typeof value]),
            ),
        }));

        expect(rendererBoundary).toMatchObject({
            process: 'undefined',
            require: 'undefined',
            buffer: 'undefined',
            electron: 'undefined',
            runtimeKeys: ['analyticsConfig', 'futuresReadEnvironment', 'localWebSocketAccess'],
            runtimeValueTypes: {
                analyticsConfig: 'object',
                futuresReadEnvironment: 'string',
                localWebSocketAccess: 'object',
            },
        });

        const popupBlocked = await mainWindow.evaluate(() => window.open('https://example.com/') === null);
        expect(popupBlocked).toBe(true);

        await mainWindow.evaluate(() => {
            globalThis.__inlineScriptExecuted = false;
            const script = document.createElement('script');
            script.textContent = 'globalThis.__inlineScriptExecuted = true';
            document.head.appendChild(script);
        });
        await mainWindow.waitForTimeout(100);
        await expect.poll(() => mainWindow.evaluate(() => globalThis.__inlineScriptExecuted)).toBe(false);

        const blockedConnection = await mainWindow.evaluate(async () => {
            let violation = null;
            window.addEventListener('securitypolicyviolation', (event) => {
                if (event.effectiveDirective === 'connect-src') {
                    violation = {
                        blockedURI: event.blockedURI,
                        effectiveDirective: event.effectiveDirective,
                    };
                }
            }, { once: true });

            try {
                await fetch('https://example.com/renderer-isolation');
            } catch {
                // A restrictive CSP rejects this fetch before any network request is made.
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
            return violation;
        });
        expect(blockedConnection).toMatchObject({
            blockedURI: expect.stringContaining('https://example.com'),
            effectiveDirective: 'connect-src',
        });

        const initialUrl = mainWindow.url();
        await mainWindow.evaluate(() => window.location.assign('https://example.com/')).catch(() => {});
        await mainWindow.waitForTimeout(100);
        expect(mainWindow.url()).toBe(initialUrl);

        await mainWindow.evaluate(() => window.location.assign('file:///etc/passwd')).catch(() => {});
        await mainWindow.waitForTimeout(100);
        expect(mainWindow.url()).toBe(initialUrl);
    } finally {
        await electronApp.close();
    }
});
