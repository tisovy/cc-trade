import { useEffect, useRef } from 'react'
import FuturesProductionWorkstation from '../components/features/futures/FuturesProductionWorkstation.jsx'
import { useGatewayContext } from '../context/GatewayContext.jsx'
import useFuturesTrading from '../hooks/useFuturesTrading.js'

const FuturesWorkspace = () => {
  const {
    notifyError,
    sendMessage,
    startupStatus,
    wsConnection,
  } = useGatewayContext()
  const errorFingerprintsRef = useRef(new Map())
  const futuresTrading = useFuturesTrading({
    enabled: startupStatus?.ready === true,
    wsConnection,
  })

  useEffect(() => {
    const fingerprints = errorFingerprintsRef.current
    for (const [resourceName, resource] of Object.entries(
      futuresTrading.accountResources ?? {},
    )) {
      const fingerprintKey = `resource:${resourceName}`
      if (resource?.status === 'ready') {
        fingerprints.delete(fingerprintKey)
        continue
      }
      if (resource?.status !== 'error' && resource?.status !== 'stale') continue
      const nextFingerprint = `${resource.status}:${resource.error?.code ?? 'UNKNOWN'}`
      if (fingerprints.get(fingerprintKey) === nextFingerprint) continue
      fingerprints.set(fingerprintKey, nextFingerprint)
      notifyError?.(
        `Futures ${resourceName}: ${resource.error?.message ?? 'Synchronization failed. Retry account sync.'}`,
      )
    }

    const commandKey = 'command'
    if (!futuresTrading.lastError) {
      fingerprints.delete(commandKey)
    } else {
      const commandFingerprint = `${futuresTrading.lastError.request ?? 'command'}:${futuresTrading.lastError.code ?? 'UNKNOWN'}`
      if (fingerprints.get(commandKey) !== commandFingerprint) {
        fingerprints.set(commandKey, commandFingerprint)
        notifyError?.(`Futures command rejected: ${futuresTrading.lastError.message}`)
      }
    }
  }, [
    futuresTrading.accountResources,
    futuresTrading.lastError,
    notifyError,
  ])

  return (
    <main
      className="futures-mode-view is-production"
      data-testid="futures-live-view"
      aria-label="USDⓈ-M Futures production workspace"
    >
      <FuturesProductionWorkstation
        enabled
        executionState={futuresTrading}
        wsConnection={wsConnection}
        sendMessage={sendMessage}
      />
    </main>
  )
}

export default FuturesWorkspace
