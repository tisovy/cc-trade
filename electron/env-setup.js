import { installFuturesProductionNetworkEscapeGuard } from './futures-production-network-guard.js';
import {
    installFuturesWorkstationNodeNetworkEscapeGuard,
} from './futures-workstation-node-network-guard.js';

// Force-clear credentials and network overrides for safe local launch and
// automated verification.
process.env.BK = '';
process.env.BS = '';
process.env.BFK = '';
process.env.BFS = '';
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

// A verification runtime is not a development runtime, and it does not share
// its transport. It listens on its own port, so a verification renderer cannot
// address a development backend at all — before the token check would refuse
// it, and regardless of whether either side is misconfigured. A parallel
// verification run reaching the development backend is what turned an audit
// into an `invalid token` flood in the developer's log.
export const VERIFICATION_LOCAL_WEBSOCKET_PORT = 14479;
process.env.WS_PORT = String(VERIFICATION_LOCAL_WEBSOCKET_PORT);

installFuturesProductionNetworkEscapeGuard();
installFuturesWorkstationNodeNetworkEscapeGuard();
console.log(
    `Verification: credentials and network overrides cleared; local transport isolated on port ${VERIFICATION_LOCAL_WEBSOCKET_PORT}`,
);
