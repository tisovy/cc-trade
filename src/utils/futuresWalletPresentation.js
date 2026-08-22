// Stable React identity for one additive shared-wallet presentation bucket.
//
// Bucket membership can legitimately grow when a newer income read discovers
// another row. Keeping every member identity in the key made that normal update
// remount the focusable DOM row and sorted a lane-sized array during render.
// The domain guarantees one simultaneous bucket per complete scope tuple.
export const futuresSharedAdjustmentKey = adjustment => JSON.stringify([
  'futures-wallet-shared',
  adjustment?.kind ?? null,
  adjustment?.ownerId ?? null,
  adjustment?.symbol ?? null,
  adjustment?.leg ?? null,
])

export default futuresSharedAdjustmentKey
