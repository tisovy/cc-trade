const DEFAULT_APP_TITLE = 'CC-trade';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_POLL_INTERVAL_MS = 250;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const readWindowTitle = async (windowPage) => {
    try {
        return await windowPage.title();
    } catch {
        return '';
    }
};

const readWindowUrl = (windowPage) => {
    try {
        return typeof windowPage.url === 'function' ? windowPage.url() : '';
    } catch {
        return '';
    }
};

const describeWindow = async (windowPage) => {
    const title = await readWindowTitle(windowPage);
    const url = readWindowUrl(windowPage);
    return `"${title || '<untitled>'}" ${url || '<no-url>'}`;
};

export const isDevToolsWindow = async (windowPage) => {
    const title = (await readWindowTitle(windowPage)).trim().toLowerCase();
    const url = readWindowUrl(windowPage).toLowerCase();

    return (
        title === 'devtools' ||
        title.startsWith('devtools -') ||
        title.startsWith('developer tools') ||
        url.startsWith('devtools://')
    );
};

export const waitForAppWindow = async (
    electronApp,
    {
        title = DEFAULT_APP_TITLE,
        timeout = DEFAULT_TIMEOUT_MS,
        pollInterval = DEFAULT_POLL_INTERVAL_MS,
    } = {},
) => {
    const deadline = Date.now() + timeout;
    let firstNonDevToolsWindow = null;
    let lastWindowDescriptions = [];

    while (Date.now() <= deadline) {
        const windows = await electronApp.windows();
        lastWindowDescriptions = await Promise.all(windows.map(describeWindow));

        for (const windowPage of windows) {
            if (await isDevToolsWindow(windowPage)) {
                continue;
            }

            firstNonDevToolsWindow ??= windowPage;

            if (!title || await readWindowTitle(windowPage) === title) {
                return windowPage;
            }
        }

        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            break;
        }

        await sleep(Math.min(pollInterval, remainingMs));
    }

    if (firstNonDevToolsWindow) {
        return firstNonDevToolsWindow;
    }

    throw new Error(`App window not found. Observed windows: ${lastWindowDescriptions.join(', ') || '<none>'}`);
};
