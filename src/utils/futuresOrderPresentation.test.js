import { describe, expect, it } from 'vitest'
import {
  describeFuturesAlgoTrigger,
  describeFuturesCloseOutcome,
  describeFuturesOrderIntent,
  describeFuturesPosition,
  describeFuturesPositionMargin,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
  orderFilledNotionalUsdt,
  orderNotionalUsdt,
  orderPresentationPrice,
  projectLiquidationPrice,
  totalOrderNotionalUsdt,
} from './futuresOrderPresentation.js'

describe('totalOrderNotionalUsdt', () => {
  const order = (price, origQty, extra = {}) => ({ price, origQty, ...extra })

  it('adds up what the rows of the list add up to', () => {
    expect(totalOrderNotionalUsdt([
      order('58445.0', '2'),
      order('2500.5', '12', { reduceOnly: true }),
    ])).toBeCloseTo(146896, 6)
  })

  it('prices a triggered order the same way the row does', () => {
    const stop = order('0', '0.5', { triggerPrice: '60000' })
    expect(orderNotionalUsdt(stop)).toBe('30000')
    expect(totalOrderNotionalUsdt([stop])).toBe(30000)
  })

  it('prices a stop-limit at its positive limit before its trigger', () => {
    const stopLimit = order('57900', '0.5', { triggerPrice: '58000' })
    expect(orderPresentationPrice(stopLimit)).toBe('57900')
    expect(orderNotionalUsdt(stopLimit)).toBe('28950')
    expect(totalOrderNotionalUsdt([stopLimit])).toBe(28950)
    expect(orderPresentationPrice(order('0', '0.5', { triggerPrice: '58000' })))
      .toBe('58000')
  })

  it('states filled value in USDT from stream or snapshot executed contracts', () => {
    expect(orderFilledNotionalUsdt(order('100', '10', { z: '2' }))).toBe('200')
    expect(orderFilledNotionalUsdt(order('100', '10', { executedQty: '2' }))).toBe('200')
    expect(orderFilledNotionalUsdt(order('0', '1', {
      triggerPrice: '58000', executedQty: '0.1',
    }))).toBe('5800')
    expect(orderFilledNotionalUsdt(order('100', '10', { z: '0' }))).toBe('0.00')
  })

  // Half of a working order can already be a position. What rests on the book
  // is the remainder, and pricing the order at the size it was placed at
  // overstates what the operator still has working — on the chart label, in the
  // row, and in the total they read against their balance.
  it('prices a partly filled order at what is still working', () => {
    expect(orderNotionalUsdt(order('100', '10', { executedQty: '5' }))).toBe('500')
    // The stream names the filled part `z`; a snapshot names it `executedQty`.
    expect(orderNotionalUsdt(order('100', '10', { z: '5' }))).toBe('500')
    expect(totalOrderNotionalUsdt([
      order('100', '10', { executedQty: '5' }),
      order('100', '4'),
    ])).toBe(900)
  })

  // Nothing resting is a reading; a list that could not be read is not.
  it('separates an empty list from one nothing could be priced from', () => {
    expect(totalOrderNotionalUsdt([])).toBe(0)
    expect(totalOrderNotionalUsdt([order(null, null)])).toBeNull()
    expect(totalOrderNotionalUsdt(null)).toBeNull()
  })

  // `Number(null)` is 0, and a row reading `0` in a column of order values reads
  // as an order that commits nothing rather than as one that could not be read.
  it('refuses to value an order with no price or no size', () => {
    expect(orderNotionalUsdt(order(null, '2'))).toBeNull()
    expect(orderNotionalUsdt(order('58000', null))).toBeNull()
    // A close-position stop carries no quantity of its own.
    expect(orderNotionalUsdt(order('0', '0', { triggerPrice: '58000', closePosition: true })))
      .toBeNull()
    // A market-triggered stop read without its trigger carries no price.
    expect(orderNotionalUsdt(order('0', '0.5'))).toBeNull()
  })

  it('still totals the rows it can price when one of them it cannot', () => {
    expect(totalOrderNotionalUsdt([order('100', '2'), order(undefined, '3')])).toBe(200)
  })
})

describe('describeFuturesAlgoTrigger', () => {
  const algo = extra => ({
    orderKind: 'ALGO',
    algoType: 'CONDITIONAL',
    triggerPrice: '57000',
    ...extra,
  })

  it('names the regular order a fired parent spawned, and the price it fired at', () => {
    expect(describeFuturesAlgoTrigger(algo({
      actualOrderId: '990281234',
      actualPrice: '56980.1',
    }))).toMatchObject({
      triggered: true,
      spawnedOrderId: '990281234',
      spawnedPrice: '56980.1',
    })
  })

  // The exchange states "has not fired" as an empty string. Read as a missing
  // value it would be a null; read as a number it would be a zero; read as
  // truthiness it would be false either way — and only one of those is what
  // Binance said.
  it('reads the exchange\'s empty value as an order still resting', () => {
    expect(describeFuturesAlgoTrigger(algo({ actualOrderId: '', actualPrice: '' })).triggered)
      .toBe(false)
    expect(describeFuturesAlgoTrigger(algo({ actualOrderId: '   ' })).triggered).toBe(false)
    // A response that never mentioned the field says nothing either way, which
    // is how the desk behaved before it was told at all.
    expect(describeFuturesAlgoTrigger(algo()).triggered).toBe(false)
  })

  // A fired parent whose spawned order has not printed yet has no fill price.
  // An empty string there is that absence, not a price of nothing.
  it('separates a spawned order with no price from one priced at zero', () => {
    expect(describeFuturesAlgoTrigger(algo({
      actualOrderId: '990281234', actualPrice: '',
    })).spawnedPrice).toBeNull()
    expect(describeFuturesAlgoTrigger(algo({
      actualOrderId: '990281234', actualPrice: '0',
    })).spawnedPrice).toBe('0')
  })

  // Identity lives in two namespaces. A regular order carrying the same fields
  // is not an algorithmic parent, and must never be read as one.
  it('claims nothing about an order that is not algorithmic', () => {
    expect(describeFuturesAlgoTrigger({
      orderKind: 'REGULAR', actualOrderId: '990281234',
    }).triggered).toBe(false)
    expect(describeFuturesAlgoTrigger(undefined).triggered).toBe(false)
  })

  // A scheduled algo names its current child order in exactly the field a
  // conditional order names the order that finished it. Read the same way, the
  // first child's fill would settle a parent that is still running — and a
  // settled identity is refused by every later snapshot, so a working TWAP
  // would leave the desk and not come back.
  it('claims nothing about an algo that outlives the order it spawned', () => {
    for (const algoType of ['TWAP', 'VP']) {
      expect(describeFuturesAlgoTrigger(algo({
        algoType,
        actualOrderId: '990281234',
        actualPrice: '56980.1',
      }))).toMatchObject({ triggered: false, spawnedOrderId: null })
    }
  })

  // An algo type the desk has not been shown is read as still working, which is
  // how it read before it was told about spawned orders at all. Being too narrow
  // costs this change its effect on that type; being too wide costs an order off
  // the screen.
  it('reads an unrecognized algo type as still working', () => {
    expect(describeFuturesAlgoTrigger(algo({
      algoType: 'SOMETHING_BINANCE_ADDS_LATER',
      actualOrderId: '990281234',
    })).triggered).toBe(false)
    expect(describeFuturesAlgoTrigger(algo({
      algoType: undefined,
      actualOrderId: '990281234',
    })).triggered).toBe(false)
  })

  // The exchange states its enums in upper case and the desk does not rewrite
  // them, but a comparison that assumed the case would silently make the whole
  // rule unreachable if it ever changed.
  it('does not depend on the case the exchange states the type in', () => {
    expect(describeFuturesAlgoTrigger(algo({
      algoType: 'conditional',
      actualOrderId: '990281234',
    })).triggered).toBe(true)
  })
})

describe('describeFuturesOrderIntent', () => {
  it('colours by side so a one-way BUY never reads as a short', () => {
    expect(describeFuturesOrderIntent({ side: 'BUY', positionSide: 'BOTH' })).toMatchObject({
      side: 'BUY',
      positionSide: 'LONG',
      positionEffect: 'ENTRY',
      tone: 'buy',
      label: 'LONG',
    })
    expect(describeFuturesOrderIntent({ side: 'SELL', positionSide: 'BOTH' })).toMatchObject({
      positionSide: 'SHORT',
      positionEffect: 'ENTRY',
      tone: 'sell',
    })
  })

  it('reads one-way reduce-only orders as exits of the opposite leg', () => {
    expect(describeFuturesOrderIntent({
      side: 'SELL', positionSide: 'BOTH', reduceOnly: true,
    })).toMatchObject({ positionSide: 'LONG', positionEffect: 'EXIT', tone: 'sell' })
    expect(describeFuturesOrderIntent({
      side: 'BUY', positionSide: 'BOTH', reduceOnly: true,
    })).toMatchObject({ positionSide: 'SHORT', positionEffect: 'EXIT', tone: 'buy' })
  })

  // Binance carries "closes the whole position" separately from reduce-only,
  // and sends a close-position stop with `reduceOnly` false. Read by
  // `reduceOnly` alone, a stop closing a long was labelled SHORT and classified
  // ENTRY — the desk named it as opening the position it exists to close.
  it('reads a close-position order as an exit whichever side it is submitted on', () => {
    expect(describeFuturesOrderIntent({
      side: 'SELL', positionSide: 'BOTH', reduceOnly: false, closePosition: true,
    })).toMatchObject({
      positionSide: 'LONG',
      positionEffect: 'EXIT',
      reducesPosition: true,
      tone: 'sell',
    })
    expect(describeFuturesOrderIntent({
      side: 'BUY', positionSide: 'BOTH', reduceOnly: false, closePosition: true,
    })).toMatchObject({
      positionSide: 'SHORT',
      positionEffect: 'EXIT',
      reducesPosition: true,
      tone: 'buy',
    })
    // And the ordinary order beside it is unmoved.
    expect(describeFuturesOrderIntent({
      side: 'SELL', positionSide: 'BOTH', closePosition: false,
    })).toMatchObject({
      positionSide: 'SHORT',
      positionEffect: 'ENTRY',
      reducesPosition: false,
    })
  })

  it('trusts the declared leg on hedge accounts', () => {
    expect(describeFuturesOrderIntent({ side: 'BUY', positionSide: 'SHORT' }))
      .toMatchObject({ positionSide: 'SHORT', positionEffect: 'EXIT', tone: 'buy' })
    expect(describeFuturesOrderIntent({ side: 'SELL', positionSide: 'SHORT' }))
      .toMatchObject({ positionSide: 'SHORT', positionEffect: 'ENTRY', tone: 'sell' })
  })
})

describe('describeFuturesPosition', () => {
  it('derives the leg from the signed quantity and reports ROE against margin', () => {
    expect(describeFuturesPosition({
      symbol: 'BTCUSDT',
      positionSide: 'BOTH',
      quantity: '-0.5',
      entryPrice: '60000',
      leverage: '10',
      unrealizedPnl: '-150',
    })).toMatchObject({
      positionSide: 'SHORT',
      tone: 'sell',
      absoluteQuantity: 0.5,
      notional: 30000,
      pnlTone: 'negative',
    })
    expect(describeFuturesPosition({
      quantity: '0.5', entryPrice: '60000', leverage: '10', unrealizedPnl: '300',
    }).roePercent).toBeCloseTo(10)
  })

  it('values a short at the mark as an amount, not as a negative number', () => {
    expect(describeFuturesPosition({
      quantity: '-0.5',
      entryPrice: '60000',
      markPrice: '60600',
    }).markNotional).toBe(30300)
  })

  it('stays neutral when the exchange has not reported numbers yet', () => {
    expect(describeFuturesPosition({})).toMatchObject({
      positionSide: 'LONG',
      quantity: null,
      roePercent: null,
      pnlTone: 'flat',
    })
  })
})

describe('describeFuturesPositionMargin', () => {
  // `/fapi/v3/positionRisk` reports no marginType, so the mode has to be read
  // from the walled-off funds themselves.
  it('reads the isolated mode from the wallet the position holds', () => {
    expect(describeFuturesPositionMargin({
      quantity: '0.5',
      entryPrice: '60000',
      isolatedWallet: '512.4',
      isolatedMargin: '480',
      initialMargin: '300',
    })).toMatchObject({ marginMode: 'ISOLATED', margin: 512.4, adjustable: true })
  })

  it('reports a position with no isolated wallet as cross and refuses adjustment', () => {
    expect(describeFuturesPositionMargin({
      quantity: '0.5',
      entryPrice: '60000',
      isolatedWallet: '0',
      initialMargin: '3000',
    })).toMatchObject({ marginMode: 'CROSS', margin: 3000, adjustable: false })
  })

  it('believes a source that states the mode outright', () => {
    expect(describeFuturesPositionMargin({
      marginType: 'CROSSED', quantity: '0.5', entryPrice: '60000', leverage: '10',
    })).toMatchObject({ marginMode: 'CROSS', adjustable: false })
    expect(describeFuturesPositionMargin({
      marginType: 'ISOLATED', quantity: '0.5', entryPrice: '60000', initialMargin: '3000',
    })).toMatchObject({ marginMode: 'ISOLATED', margin: 3000, adjustable: true })
  })

  it('reports no margin at all rather than a confident zero', () => {
    expect(describeFuturesPositionMargin({ quantity: '0.5', entryPrice: '60000' }))
      .toMatchObject({ marginMode: null, margin: null, adjustable: false })
    expect(describeFuturesPositionMargin({})).toMatchObject({ margin: null, adjustable: false })
  })

  // The distance to liquidation, measured in money: the position is closed when
  // its margin balance reaches the maintenance requirement.
  it('measures the margin standing above the liquidation floor', () => {
    expect(describeFuturesPositionMargin({
      isolatedWallet: '1200',
      maintenanceMargin: '38.8',
      unrealizedPnl: '0',
    })).toMatchObject({
      maintenanceMargin: 38.8,
      marginBalance: 1200,
      liquidationBuffer: 1161.2,
      removable: 1161.2,
    })
  })

  it('takes an unrealized loss out of the buffer and leaves an unrealized profit out of it', () => {
    // The loss has already been taken out of the margin behind the position.
    expect(describeFuturesPositionMargin({
      isolatedWallet: '1200', maintenanceMargin: '40', unrealizedPnl: '-300',
    })).toMatchObject({ marginBalance: 900, liquidationBuffer: 860 })
    // The profit is not in the wallet and cannot be withdrawn, so it buys no
    // headroom to remove margin with.
    expect(describeFuturesPositionMargin({
      isolatedWallet: '1200', maintenanceMargin: '40', unrealizedPnl: '300',
    })).toMatchObject({ marginBalance: 1200, liquidationBuffer: 1160 })
  })

  // Between two marks the visible uPnL is the desk's arithmetic on the last
  // traded price. Everything here is a statement about liquidation, which is the
  // mark's by definition — measuring the buffer from an estimate would put a
  // wrong distance under a real liquidation, and would offer margin for
  // withdrawal that the position may not actually be able to spare.
  it('measures the buffer from the mark, never from the estimate beside it', () => {
    expect(describeFuturesPositionMargin({
      isolatedWallet: '1200',
      maintenanceMargin: '40',
      unrealizedPnl: '-100',
      markUnrealizedPnl: '-300',
    })).toMatchObject({ marginBalance: 900, liquidationBuffer: 860 })
  })

  it('reports nothing removable when the position is already under its floor', () => {
    expect(describeFuturesPositionMargin({
      isolatedWallet: '1200', maintenanceMargin: '40', unrealizedPnl: '-1180',
    })).toMatchObject({ liquidationBuffer: -20, removable: 0 })
  })

  // A cross position's buffer belongs to the account, not to one row of a table.
  it('claims no per-position buffer for a cross position', () => {
    expect(describeFuturesPositionMargin({
      isolatedWallet: '0', initialMargin: '3000', maintenanceMargin: '40',
    })).toMatchObject({ marginMode: 'CROSS', liquidationBuffer: null, removable: null })
  })

  it('draws no floor when the read carries no maintenance requirement', () => {
    expect(describeFuturesPositionMargin({ isolatedWallet: '1200' }))
      .toMatchObject({ maintenanceMargin: null, liquidationBuffer: null, removable: null })
  })

  // The row shows the percentage and the amount it was divided by. Computing
  // them apart is how the two come to disagree.
  it('is the denominator of the ROE on the same row', () => {
    const position = {
      quantity: '0.5', entryPrice: '60000', isolatedWallet: '1500', unrealizedPnl: '150',
    }
    const { margin } = describeFuturesPositionMargin(position)
    expect(margin).toBe(1500)
    expect(describeFuturesPosition(position).roePercent).toBeCloseTo(10)
  })
})

describe('signed formatting', () => {
  it('always shows the sign so gains and losses are distinguishable at a glance', () => {
    expect(formatSignedUsdt('12.3456')).toBe('+12.35')
    expect(formatSignedUsdt(-4)).toBe('−4.00')
    expect(formatSignedUsdt(0)).toBe('0.00')
    expect(formatSignedUsdt('abc')).toBe('—')
    expect(formatSignedPercent(-3.5)).toBe('−3.50%')
  })

  it('reports an absent number as absent instead of as a confident zero', () => {
    expect(formatSignedUsdt(null)).toBe('—')
    expect(formatSignedPercent(undefined)).toBe('—')
    expect(describeFuturesPosition({ quantity: '1', entryPrice: '10' }).roePercent).toBeNull()
  })

  it('states an amount without a sign, because an amount has no direction', () => {
    expect(formatUsdt('15716.4949')).toBe('15716.49')
    expect(formatUsdt(-15716.49)).toBe('15716.49')
    expect(formatUsdt(null)).toBe('—')
  })
})

describe('projectLiquidationPrice', () => {
  // Margin does not change the size of the position, so a transfer moves the
  // liquidation price by itself spread over the quantity.
  it('moves the price away from the entry when margin is added', () => {
    expect(projectLiquidationPrice({
      liquidationPrice: '54680',
      quantity: '0.5',
      positionSide: 'LONG',
      marginDelta: 250,
    })).toBeCloseTo(54180, 6)
    expect(projectLiquidationPrice({
      liquidationPrice: '59320',
      quantity: '-0.5',
      positionSide: 'SHORT',
      marginDelta: 250,
    })).toBeCloseTo(59820, 6)
  })

  it('pulls it in when margin is taken out', () => {
    expect(projectLiquidationPrice({
      liquidationPrice: '54680',
      quantity: '0.5',
      positionSide: 'LONG',
      marginDelta: -200,
    })).toBeCloseTo(55080, 6)
  })

  // A price is never negative, however much margin is withdrawn on paper: the
  // position is long gone before the arithmetic gets there.
  it('never projects a price below zero', () => {
    expect(projectLiquidationPrice({
      liquidationPrice: '10',
      quantity: '1',
      positionSide: 'LONG',
      marginDelta: 500,
    })).toBe(0)
  })

  it('states nothing rather than a guess when an input is missing', () => {
    const base = { liquidationPrice: '54680', quantity: '0.5', positionSide: 'LONG' }
    // Binance reports 0 for a position it has no liquidation price for.
    expect(projectLiquidationPrice({ ...base, liquidationPrice: '0', marginDelta: 250 })).toBeNull()
    expect(projectLiquidationPrice({ ...base, quantity: '0', marginDelta: 250 })).toBeNull()
    expect(projectLiquidationPrice({ ...base, marginDelta: null })).toBeNull()
    expect(projectLiquidationPrice({ ...base, marginDelta: 0 })).toBeNull()
    expect(projectLiquidationPrice()).toBeNull()
  })
})

describe('describeFuturesCloseOutcome', () => {
  it('values the exit and the profit it would take', () => {
    expect(describeFuturesCloseOutcome({
      positionSide: 'LONG',
      entryPrice: '57000',
      quantity: '0.25',
      exitPrice: '58445.07',
    })).toEqual({
      notional: 0.25 * 58445.07,
      realizedPnl: (58445.07 - 57000) * 0.25,
    })
  })

  // The same mark above the same entry is a loss on the other side of the book.
  it('reads a short’s profit from the other direction', () => {
    const { realizedPnl } = describeFuturesCloseOutcome({
      positionSide: 'SHORT',
      entryPrice: '57000',
      quantity: '0.5',
      exitPrice: '58445.07',
    })
    expect(realizedPnl).toBeLessThan(0)
    expect(realizedPnl).toBeCloseTo(-722.535, 6)
  })

  // Without an entry price there is no profit to state, and 0.00 would read as a
  // break-even exit rather than as an unknown one.
  it('reports an absent profit as absent while still valuing the exit', () => {
    expect(describeFuturesCloseOutcome({
      positionSide: 'LONG',
      quantity: '0.5',
      exitPrice: '100',
    })).toEqual({ notional: 50, realizedPnl: null })
    expect(describeFuturesCloseOutcome({
      positionSide: 'LONG',
      entryPrice: '57000',
      quantity: null,
      exitPrice: '58445.07',
    })).toEqual({ notional: null, realizedPnl: null })
    expect(describeFuturesCloseOutcome()).toEqual({ notional: null, realizedPnl: null })
  })
})
