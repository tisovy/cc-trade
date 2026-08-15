import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FUTURES_WORKSTATION_REQUEST_MAX_BYTES,
} from '../utils/futuresWorkstationProtocolShared.js'
import { LOCAL_WEBSOCKET_AUTH_CLOSE_CODE } from '../utils/localWebSocketAccess.js'

export const FUTURES_LOCAL_WORKSTATION_CONNECTION_LIMITS = Object.freeze({
  CONNECT_TIMEOUT_MS: 10_000,
  RECONNECT_ATTEMPTS: 8,
  RECONNECT_BASE_MS: 250,
  RECONNECT_MAX_MS: 5_000,
})

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{0,256}$/

// No runtime means no address. This used to fall back to `127.0.0.1:14477`
// with an empty token — a real endpoint that answers 401 — so a window that was
// never issued a runtime kept dialling one it could never authenticate against.
const readExactLocalWorkstationAccess = () => {
  const access = globalThis.ccTradeRuntime?.localWebSocketAccess
  if (access === null
    || typeof access !== 'object'
    || Array.isArray(access)
    || !LOOPBACK_HOSTS.has(access.host)
    || !Number.isSafeInteger(access.port)
    || access.port < 1
    || access.port > 65535
    || typeof access.token !== 'string'
    || !TOKEN_PATTERN.test(access.token)
    || access.tokenParam !== 'token') {
    return null
  }
  return access
}

const createExactLocalWorkstationUrl = () => {
  const access = readExactLocalWorkstationAccess()
  if (access === null) return null
  const host = access.host === '::1' ? '[::1]' : access.host
  const url = new URL(`ws://${host}:${access.port}`)
  if (access.token) url.searchParams.set(access.tokenParam, access.token)
  return url.toString()
}

const useFuturesLocalWorkstationConnection = ({ enabled }) => {
  const socketRef = useRef(null)
  const [wsConnection, setWsConnection] = useState(null)

  const sendMessage = useCallback((message) => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== 1) return false
    try {
      const serialized = JSON.stringify(message)
      if (new TextEncoder().encode(serialized).byteLength
        > FUTURES_WORKSTATION_REQUEST_MAX_BYTES) return false
      socket.send(serialized)
      return true
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    if (!enabled || typeof globalThis.WebSocket !== 'function') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWsConnection(null)
      return undefined
    }

    let active = true
    let reconnectAttempts = 0
    let reconnectTimer = null
    let connectionTimer = null

    const scheduleReconnect = () => {
      if (!active
        || reconnectTimer !== null
        || reconnectAttempts >= FUTURES_LOCAL_WORKSTATION_CONNECTION_LIMITS.RECONNECT_ATTEMPTS) {
        return
      }
      const delay = Math.min(
        FUTURES_LOCAL_WORKSTATION_CONNECTION_LIMITS.RECONNECT_MAX_MS,
        FUTURES_LOCAL_WORKSTATION_CONNECTION_LIMITS.RECONNECT_BASE_MS
          * (2 ** reconnectAttempts),
      )
      reconnectAttempts += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, delay)
    }

    const connect = () => {
      if (!active) return
      const url = createExactLocalWorkstationUrl()
      if (url === null) return
      let socket
      try {
        socket = new globalThis.WebSocket(url)
      } catch {
        scheduleReconnect()
        return
      }
      socketRef.current = socket
      connectionTimer = setTimeout(() => {
        connectionTimer = null
        if (!active || socketRef.current !== socket || socket.readyState !== 0) return
        try {
          socket.close()
        } catch {
          scheduleReconnect()
        }
      }, FUTURES_LOCAL_WORKSTATION_CONNECTION_LIMITS.CONNECT_TIMEOUT_MS)
      socket.onopen = () => {
        if (!active || socketRef.current !== socket) return
        if (connectionTimer !== null) clearTimeout(connectionTimer)
        connectionTimer = null
        reconnectAttempts = 0
        setWsConnection(socket)
      }
      socket.onclose = (event) => {
        if (connectionTimer !== null) clearTimeout(connectionTimer)
        connectionTimer = null
        if (socketRef.current === socket) socketRef.current = null
        if (!active) return
        setWsConnection(previous => previous === socket ? null : previous)
        // The next attempt would carry the same refused token. Reconnecting on
        // an authentication failure only repeats it.
        if (event?.code === LOCAL_WEBSOCKET_AUTH_CLOSE_CODE) return
        scheduleReconnect()
      }
      socket.onerror = () => {
        try {
          socket.close()
        } catch {
          scheduleReconnect()
        }
      }
    }

    connect()
    return () => {
      active = false
      if (reconnectTimer !== null) clearTimeout(reconnectTimer)
      if (connectionTimer !== null) clearTimeout(connectionTimer)
      const socket = socketRef.current
      socketRef.current = null
      if (socket) {
        socket.onopen = null
        socket.onclose = null
        socket.onerror = null
        try {
          socket.close()
        } catch {
          // The exact local socket is already terminal.
        }
      }
    }
  }, [enabled])

  return { wsConnection, sendMessage }
}

export default useFuturesLocalWorkstationConnection
export { useFuturesLocalWorkstationConnection }
