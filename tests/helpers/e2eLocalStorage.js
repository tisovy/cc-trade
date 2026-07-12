const DEFAULT_E2E_CHART_CONFIGS = [
    { symbol: 'PAXUSDT', interval: '1h' },
    { symbol: 'BTCUSDT', interval: '1h' },
    { symbol: 'ETHUSDT', interval: '1h' },
    { symbol: 'BNBUSDT', interval: '1h' },
    { symbol: 'XRPUSDT', interval: '1h' },
    { symbol: 'SOLUSDT', interval: '1h' },
    { symbol: 'ADAUSDT', interval: '1h' },
    { symbol: 'DOGEUSDT', interval: '1h' },
];

const E2E_STORAGE_KEYS = [
    'MOCK_WS_URL',
    'currentView',
    'panel',
    'mainViewCharts',
    'mainViewSelectedSlot',
    'mainViewShowActivity',
    'showOrderHistory',
    'orderBook',
    'market_history',
    'orders_history',
    'enabled_market_balance',
    'trade_notional_filter',
    'activity_volume_filter',
    'analytics_volume_filter',
];

const buildE2eStoragePayload = ({
    mockWsUrl = null,
    selected = 'BTCUSDT',
    market = 'USDT',
    interval = '1h',
    currentView = 'depth',
    chartConfigs = DEFAULT_E2E_CHART_CONFIGS,
} = {}) => {
    const panel = { selected, market, interval };
    const storage = {
        currentView,
        panel: JSON.stringify(panel),
        mainViewCharts: JSON.stringify(chartConfigs),
        mainViewSelectedSlot: '0',
        mainViewShowActivity: JSON.stringify(true),
        showOrderHistory: JSON.stringify('VISIBLE'),
        market_history: JSON.stringify(['ETHUSDT', 'BNBUSDT']),
        orders_history: JSON.stringify({ [selected]: [] }),
        enabled_market_balance: JSON.stringify(false),
        trade_notional_filter: JSON.stringify(150),
        activity_volume_filter: JSON.stringify(10000000),
        analytics_volume_filter: JSON.stringify(10000000),
    };

    if (mockWsUrl) {
        storage.MOCK_WS_URL = mockWsUrl;
    }

    return {
        mockWsUrl,
        storage,
        keysToReset: E2E_STORAGE_KEYS,
    };
};

const applyE2eStoragePayload = ({ keysToReset, storage, mockWsUrl }) => {
    for (const key of keysToReset) {
        window.localStorage.removeItem(key);
    }

    for (const [key, value] of Object.entries(storage)) {
        window.localStorage.setItem(key, value);
    }

    if (mockWsUrl) {
        window.MOCK_WS_URL = mockWsUrl;
    } else {
        delete window.MOCK_WS_URL;
    }
};

export const installE2eLocalStorage = async (page, options = {}) => {
    const payload = buildE2eStoragePayload(options);
    await page.context().addInitScript(applyE2eStoragePayload, payload);
    await page.evaluate(applyE2eStoragePayload, payload);
};

export const reloadWithE2eLocalStorage = async (page, options = {}) => {
    const payload = buildE2eStoragePayload(options);
    await page.context().addInitScript(applyE2eStoragePayload, payload);

    const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
    const reload = page.evaluate(({ keysToReset, storage, mockWsUrl }) => {
        for (const key of keysToReset) {
            window.localStorage.removeItem(key);
        }

        for (const [key, value] of Object.entries(storage)) {
            window.localStorage.setItem(key, value);
        }

        if (mockWsUrl) {
            window.MOCK_WS_URL = mockWsUrl;
        } else {
            delete window.MOCK_WS_URL;
        }

        window.location.reload();
    }, payload).catch((error) => {
        if (!/Execution context was destroyed|most likely because of a navigation/i.test(String(error))) {
            throw error;
        }
    });

    await Promise.all([navigation, reload]);
};
