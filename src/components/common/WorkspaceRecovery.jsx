import { useGatewayContext } from '../../context/GatewayContext.jsx'
import './RenderErrorBoundary.css'

export default function WorkspaceRecovery({ title, onRetry, reload = false }) {
  const { wsConnection, marketActivation } = useGatewayContext()
  const connected = wsConnection?.readyState === 1
  return (
    <section className="render-failure is-workspace" role="alert">
      <h1>{title} unavailable</h1>
      <p role="status">
        Local connection: {connected ? 'connected' : 'unavailable'}.{' '}
        Market activation: {connected && marketActivation?.marketMode ? 'acknowledged' : 'unconfirmed'}.
      </p>
      <p>This view cannot verify account or order state. Existing exchange orders may still be active.</p>
      <p>Check the exchange before repeating any command. Recovering the interface does not cancel or resend orders.</p>
      <button type="button" onClick={onRetry}>{reload ? 'Reload interface' : 'Retry view'}</button>
    </section>
  )
}
