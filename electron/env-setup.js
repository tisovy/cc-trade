import { installFuturesProductionNetworkEscapeGuard } from './futures-production-network-guard.js';

// Force clear environment variables for E2E tests
process.env.BK = '';
process.env.BS = '';
process.env.FUTURES_READ_MODE = 'mock';
process.env.FUTURES_READ_MOCK_SCENARIO = 'one-way';
delete process.env.FUTURES_TESTNET_API_KEY;
delete process.env.FUTURES_TESTNET_API_SECRET;
for (const key of Object.keys(process.env)) {
    if (key.startsWith('FUTURES_TESTNET_EXECUTION_')) {
        delete process.env[key];
    }
    if (key.startsWith('FUTURES_PRODUCTION_')) {
        delete process.env[key];
    }
}
delete process.env.MOCK_WS_URL;
delete process.env.VITE_WS_URL;
installFuturesProductionNetworkEscapeGuard();
console.log('E2E: Environment variables cleared');
