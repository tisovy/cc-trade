import { describe, expect, it } from 'vitest'
import {
  isFuturesTradingGestureTarget,
  resolveFuturesTradingGesture,
} from './futuresTradingGestures.js'

describe('futuresTradingGestures', () => {
  it.each([
    [{ button: 'left', altKey: true }, ['BUY', 'LONG', 'ENTRY']],
    [{ button: 'right', altKey: true }, ['SELL', 'LONG', 'EXIT']],
    [{ button: 'right', ctrlKey: true }, ['SELL', 'SHORT', 'ENTRY']],
    [{ button: 'left', ctrlKey: true }, ['BUY', 'SHORT', 'EXIT']],
  ])('maps an exact gesture to an unambiguous hedge intent', (gesture, expected) => {
    const result = resolveFuturesTradingGesture(gesture)
    expect([result.side, result.positionSide, result.positionEffect]).toEqual(expected)
  })

  it('rejects ambiguous or augmented modifier combinations', () => {
    expect(resolveFuturesTradingGesture({ button: 'left' })).toBeNull()
    expect(resolveFuturesTradingGesture({ button: 'left', altKey: true, ctrlKey: true })).toBeNull()
    expect(resolveFuturesTradingGesture({ button: 'right', ctrlKey: true, shiftKey: true })).toBeNull()
  })

  it('does not activate trading gestures over controls or dialogs', () => {
    document.body.innerHTML = '<div id="chart"><span id="canvas"></span></div><input id="input"><div role="dialog"><span id="modal"></span></div>'
    expect(isFuturesTradingGestureTarget(document.querySelector('#canvas'))).toBe(true)
    expect(isFuturesTradingGestureTarget(document.querySelector('#input'))).toBe(false)
    expect(isFuturesTradingGestureTarget(document.querySelector('#modal'))).toBe(false)
  })
})
