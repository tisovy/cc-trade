import { useCallback, useEffect, useRef, useState } from 'react'

const MARGIN = 12

// Modeless panels over the chart: draggable by their handle, dismissed by a
// click anywhere outside or by Escape. The trader keeps watching price while
// the panel is open, so it must never take over the screen and never trap focus.
export const useFloatingPanel = ({ anchor, width, onClose, minHeight = 200 }) => {
  const clampToViewport = useCallback(({ x, y }) => ({
    x: Math.max(MARGIN, Math.min(x, (globalThis.innerWidth ?? 1200) - width - MARGIN)),
    y: Math.max(MARGIN, Math.min(y, (globalThis.innerHeight ?? 800) - minHeight)),
  }), [minHeight, width])

  const [position, setPosition] = useState(() => clampToViewport(anchor ?? { x: 0, y: 0 }))
  const panelRef = useRef(null)
  const dragRef = useRef(null)

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
