import { installFuturesProductionNetworkEscapeGuard } from './futures-production-network-guard.js';
import {
    installFuturesWorkstationNodeNetworkEscapeGuard,
} from './futures-workstation-node-network-guard.js';

// Force-clear credentials and network overrides for safe local launch and
// automated verification.
process.env.BK = '';
process.env.BS = '';
for (const key of Object.keys(process.env)) {
    if (key.startsWith('FUTURES_TESTNET_') || key.startsWith('FUTURES_READ_')) {
        delete process.env[key];
    }
    if (key.startsWith('FUTURES_PRODUCTION_')) {
        delete process.env[key];
    }
}
delete process.env.MOCK_WS_URL;
delete process.env.VITE_WS_URL;
installFuturesProductionNetworkEscapeGuard();
installFuturesWorkstationNodeNetworkEscapeGuard();
console.log('Verification: credentials and network overrides cleared');
