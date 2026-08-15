import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const MARGIN = 12

// A panel taller than the window cannot be fully placed; pinning it to the top
// keeps its heading and its first controls reachable.
const clampWithin = ({ x, y }, width, height) => ({
  x: Math.max(MARGIN, Math.min(x, (globalThis.innerWidth ?? 1200) - width - MARGIN)),
  y: Math.max(MARGIN, Math.min(y, (globalThis.innerHeight ?? 800) - height - MARGIN)),
})

// Modeless panels over the chart: draggable by their handle, dismissed by a
// click anywhere outside or by Escape. The trader keeps watching price while
// the panel is open, so it must never take over the screen and never trap focus.
export const useFloatingPanel = ({ anchor, width, onClose, minHeight = 200 }) => {
  // The panel is placed before it has been laid out, so the first clamp can only
  // use an assumed height. That assumption is what put a tall panel through the
  // bottom of the window when the app itself sat low on the desktop, so the
  // measured height replaces it as soon as there is one — and again whenever the
  // content grows, since the panel's own contents change with what is typed.
  const heightRef = useRef(minHeight)

  const clampToViewport = useCallback(
    point => clampWithin(point, width, Math.max(minHeight, heightRef.current)),
    [minHeight, width],
  )

  // The first placement can only use the assumed height: nothing has been laid
  // out yet. The effect below replaces it with the measured one.
  const [position, setPosition] = useState(
    () => clampWithin(anchor ?? { x: 0, y: 0 }, width, minHeight),
  )
  const panelRef = useRef(null)
  const dragRef = useRef(null)

  useLayoutEffect(() => {
    const node = panelRef.current
    if (!node) return undefined
    const remeasure = () => {
      const height = node.offsetHeight
      if (!height || height === heightRef.current) return
      heightRef.current = height
      setPosition(current => clampToViewport(current))
    }
    remeasure()
    const ResizeObserverImpl = globalThis.ResizeObserver
    if (typeof ResizeObserverImpl !== 'function') return undefined
    const observer = new ResizeObserverImpl(remeasure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [clampToViewport])

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (panelRef.current?.contains(event.target)) return
      onClose?.()
    }
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return
    // The handle carries the panel's own close button. Capturing the pointer
    // for a drag redirects every event that follows — including the click — to
    // the handle, so a press that starts on a control belongs to that control
    // and never to a drag.
    if (event.target?.closest?.('button, input, select, textarea, a')) return
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [position.x, position.y])

  const onPointerMove = useCallback((event) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    setPosition(clampToViewport({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    }))
  }, [clampToViewport])

  const onPointerUp = useCallback((event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }, [])

  return {
    panelRef,
    style: { left: `${position.x}px`, top: `${position.y}px`, width: `${width}px` },
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  }
}

export default useFloatingPanel
