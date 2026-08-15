import { fireEvent, render, screen } from '@testing-library/react'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useFloatingPanel from './useFloatingPanel.js'

// jsdom lays nothing out, so the panel's height has to be supplied — it is the
// whole subject of these tests.
let panelHeight = 0
let resizeCallbacks = []

const Panel = ({ anchor }) => {
  const { panelRef, style } = useFloatingPanel({ anchor, width: 260, onClose: vi.fn() })
  return <div data-testid="panel" ref={panelRef} style={style} />
}

const DraggablePanel = ({ onClose }) => {
  const { panelRef, style, handleProps } = useFloatingPanel({
    anchor: { x: 100, y: 100 },
    width: 260,
    onClose,
  })
  return (
    <div data-testid="panel" ref={panelRef} style={style}>
      <header data-testid="handle" {...handleProps}>
        <button type="button" onClick={onClose}>Close</button>
      </header>
    </div>
  )
}

const topOf = () => screen.getByTestId('panel').style.top

beforeEach(() => {
  panelHeight = 0
  resizeCallbacks = []
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get: () => panelHeight,
  })
  globalThis.ResizeObserver = class {
    constructor(callback) { resizeCallbacks.push(callback) }
    observe() {}
    disconnect() {}
  }
  globalThis.innerWidth = 1400
  globalThis.innerHeight = 800
})

afterEach(() => {
  delete HTMLElement.prototype.offsetHeight
  delete globalThis.ResizeObserver
})

describe('useFloatingPanel placement', () => {
  // With the app window sitting low on the desktop, a click near its bottom
  // edge used to put the panel's last controls below the window.
  it('keeps a panel opened near the bottom edge wholly inside the window', () => {
    panelHeight = 420
    render(<Panel anchor={{ x: 300, y: 760 }} />)
    expect(topOf()).toBe('368px')
  })

  it('corrects the placement when the panel grows after it opens', () => {
    panelHeight = 180
    render(<Panel anchor={{ x: 300, y: 500 }} />)
    expect(topOf()).toBe('500px')
    panelHeight = 500
    act(() => { resizeCallbacks.forEach(callback => callback()) })
    expect(topOf()).toBe('288px')
  })

  // Nothing can place a panel that does not fit. The heading and the first
  // controls are the part worth keeping reachable.
  it('pins a panel taller than the window to the top edge', () => {
    panelHeight = 900
    render(<Panel anchor={{ x: 300, y: 400 }} />)
    expect(topOf()).toBe('12px')
  })

  it('leaves a panel opened with room below it where it was asked for', () => {
    panelHeight = 300
    render(<Panel anchor={{ x: 300, y: 120 }} />)
    expect(topOf()).toBe('120px')
  })
})

describe('useFloatingPanel dragging', () => {
  // Pointer capture redirects every event that follows to the capturing element,
  // so a drag started on the handle's own close button eats that button's click.
  it('does not start a drag from a control sitting on the handle', () => {
    const onClose = vi.fn()
    render(<DraggablePanel onClose={onClose} />)
    const handle = screen.getByTestId('handle')
    handle.setPointerCapture = vi.fn()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Close' }), {
      button: 0,
      pointerId: 1,
    })
    expect(handle.setPointerCapture).not.toHaveBeenCalled()

    fireEvent.pointerDown(handle, { button: 0, pointerId: 2 })
    expect(handle.setPointerCapture).toHaveBeenCalledWith(2)
  })

  it('moves the panel with the handle and keeps it inside the window', () => {
    panelHeight = 400
    render(<DraggablePanel onClose={vi.fn()} />)
    const handle = screen.getByTestId('handle')
    handle.setPointerCapture = vi.fn()
    handle.releasePointerCapture = vi.fn()
    fireEvent.pointerDown(handle, { button: 0, pointerId: 3, clientX: 100, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 3, clientX: 140, clientY: 900 })
    expect(topOf()).toBe('388px')
  })
})
