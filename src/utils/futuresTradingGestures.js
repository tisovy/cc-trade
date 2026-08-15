const INTENT_BY_GESTURE = Object.freeze({
  'alt:left': Object.freeze({
    side: 'BUY',
    positionSide: 'LONG',
    positionEffect: 'ENTRY',
    label: 'Enter LONG',
  }),
  'alt:right': Object.freeze({
    side: 'SELL',
    positionSide: 'LONG',
    positionEffect: 'EXIT',
    label: 'Exit LONG',
  }),
  'ctrl:right': Object.freeze({
    side: 'SELL',
    positionSide: 'SHORT',
    positionEffect: 'ENTRY',
    label: 'Enter SHORT',
  }),
  'ctrl:left': Object.freeze({
    side: 'BUY',
    positionSide: 'SHORT',
    positionEffect: 'EXIT',
    label: 'Exit SHORT',
  }),
})

export const resolveFuturesTradingGesture = ({
  button,
  altKey = false,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
} = {}) => {
  if (!['left', 'right'].includes(button)
    || metaKey
    || shiftKey
    || altKey === ctrlKey) return null
  return INTENT_BY_GESTURE[`${altKey ? 'alt' : 'ctrl'}:${button}`] ?? null
}

export const isFuturesTradingGestureTarget = (target) => {
  if (!(target instanceof Element)) return true
  return target.closest('input, select, textarea, button, [contenteditable="true"], [role="dialog"]') === null
}
