const forbiddenElectronBundleSignatures = Object.freeze([
    'futuresReadEnvironment',
    'FUTURES_READ_CHANNEL_ID',
    'FUTURES_TESTNET_EXECUTION_ACTION',
    'FUTURES_TESTNET_WORKSTATION_CHANNEL_ID',
    'reviewed-testnet-public-read',
    // Guarded-production execution ceremony (retired for the spot-parity path).
    'futures.production.placeOrder',
    'I_UNDERSTAND_REAL_USDT_FUTURES',
    'v1-persistent-block-new-exposure',
    // A normal bundle must never silently select the deterministic composition.
    'deterministic-fake',
    'FUTURES_PRODUCTION_WORKSTATION_DETERMINISTIC_VERIFICATION',
])

const requiredNormalMainSignatures = Object.freeze([
    'reviewed-public-read',
    'reviewed-production-public-read',
])

export const assertNormalElectronBuildSources = ({ mainSource, preloadSource }) => {
    const leakedSignatures = forbiddenElectronBundleSignatures.filter(signature => (
        mainSource.includes(signature) || preloadSource.includes(signature)
    ))
    if (leakedSignatures.length > 0) {
        throw new Error(
            `Retired or verification-only Futures implementation leaked into Electron build: ${leakedSignatures.join(', ')}`,
        )
    }

    const missingSignatures = requiredNormalMainSignatures.filter(signature => (
        !mainSource.includes(signature)
    ))
    if (missingSignatures.length > 0) {
        throw new Error(
            `Normal Electron build is missing reviewed production composition markers: ${missingSignatures.join(', ')}`,
        )
    }
}
