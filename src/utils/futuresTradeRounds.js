// Binance reports executions, not positions. One market close of a 136 439-unit
// position arrives as five fills in the same second, each with its own price, fee
// and slice of the realized PnL, and a session's worth of that is a wall of rows
// none of which is the number the operator is looking for. What they trade is a
// position: bought here, sold there, and the difference between the two.
//
// This walks the fills in order and folds them back into the positions they were:
// a round opens when exposure is taken and closes when it returns to flat.

const ATOM_DIGITS = 8
const ATOM_SCALE = 10n ** BigInt(ATOM_DIGITS)
const DECIMAL_PATTERN = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/

// Quantities are compared for equality with zero — that is what "the position is
// flat" means — so they are held as integers. `0.1 + 0.2 - 0.3` is 5.5e-17 in
// floating point, and a position that never reaches flat swallows every fill after
// it into one endless round.
const toAtoms = (value) => {
  const text = typeof value === 'number' && Number.isFinite(value)
    ? (String(value).includes('e') ? value.toFixed(ATOM_DIGITS) : String(value))
    : value
  if (typeof text !== 'string' || !DECIMAL_PATTERN.test(text)) return null
  const [integer, fraction = ''] = text.split('.')
  return (BigInt(integer) * ATOM_SCALE)
    + BigInt((fraction + '0'.repeat(ATOM_DIGITS)).slice(0, ATOM_DIGITS))
}

const fromAtoms = (atoms) => {
  const integer = atoms / ATOM_SCALE
  const fraction = String(atoms % ATOM_SCALE).padStart(ATOM_DIGITS, '0').replace(/0+$/, '')
  return fraction ? `${integer}.${fraction}` : String(integer)
}

// Money, not size: a missing fee or PnL is nothing rather than a reason to drop
// the fill, because the fill happened either way.
const toNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const isBuy = fill => String(fill?.side).toUpperCase() === 'BUY'

const symbolOf = fill => (typeof fill?.symbol === 'string' ? fill.symbol.toUpperCase() : '')

// `mayBeClosing` is false for the leftover of a fill that flipped the position:
// that part is known to be opening, and its fill's realized PnL was made on the
// way out of the position it just closed.
const openRound = (fill, buy, mayBeClosing) => {
  // A fill that already realizes PnL is closing something: the position it belongs
  // to was opened before this window of trades, and its entry price is not in the
  // data. Its leg is the one being closed, not the side of the fill — a BUY that
  // realizes PnL closed a short.
  const closing = mayBeClosing && toNumber(fill?.realizedPnl) !== 0
  return {
    symbol: symbolOf(fill),
    // Trade ids are numbered per contract, so two symbols can hand out the same
    // one: the symbol is part of the identity, not decoration.
    key: `${symbolOf(fill)}:${fill?.id ?? fill?.orderId ?? 'round'}:${toNumber(fill?.time)}`,
    positionSide: closing === buy ? 'SHORT' : 'LONG',
    openTime: toNumber(fill?.time),
    closeTime: toNumber(fill?.time),
    entryAtoms: 0n,
    entryNotional: 0,
    exitAtoms: 0n,
    exitNotional: 0,
    realizedPnl: 0,
    fee: 0,
    fills: 0,
    partial: closing,
  }
}

const applyFill = (round, { fill, atoms, price, share, increasing }) => {
  const size = Number(fromAtoms(atoms))
  if (increasing) {
    round.entryAtoms += atoms
    round.entryNotional += size * price
  } else {
    round.exitAtoms += atoms
    round.exitNotional += size * price
    // The whole of a fill's realized PnL belongs to the part of it that reduced
    // the position; a fill that closes one position and opens the opposite one
    // realized all of it on the way out.
    round.realizedPnl += toNumber(fill.realizedPnl)
  }
  // A fee is charged on the whole fill, so a split fill splits its fee.
  round.fee += toNumber(fill.commission) * share
  round.closeTime = toNumber(fill.time)
  round.fills += 1
}

// The entry price of a position whose opening fills are older than this window is
// not lost — the exchange's own realized PnL states it. A long realized
// (exit − entry) × size, a short realized (entry − exit) × size, and realized PnL
// is reported before commission, so inverting it is arithmetic rather than a
// guess. A row that showed `—` where the entry belongs reads as a broken record of
// a position that was in fact entered at a knowable price.
const impliedEntryPrice = ({ positionSide, exitPrice, realizedPnl, quantity }) => {
  if (exitPrice === null || !(quantity > 0)) return null
  const perUnit = realizedPnl / quantity
  const entry = positionSide === 'SHORT' ? exitPrice + perUnit : exitPrice - perUnit
  return Number.isFinite(entry) && entry > 0 ? entry : null
}

const finishRound = (round, open) => {
  const entryQuantity = Number(fromAtoms(round.entryAtoms))
  const exitQuantity = Number(fromAtoms(round.exitAtoms))
  // An open round is the size it is holding; a closed one is the size it closed.
  const quantityAtoms = open || round.exitAtoms === 0n ? round.entryAtoms : round.exitAtoms
  const exitPrice = exitQuantity > 0 ? round.exitNotional / exitQuantity : null
  const enteredHere = entryQuantity > 0
  return Object.freeze({
    key: round.key,
    symbol: round.symbol,
    positionSide: round.positionSide,
    openTime: round.openTime,
    closeTime: round.closeTime,
    quantity: fromAtoms(quantityAtoms),
    entryPrice: enteredHere
      ? round.entryNotional / entryQuantity
      : impliedEntryPrice({
        positionSide: round.positionSide,
        exitPrice,
        realizedPnl: round.realizedPnl,
        quantity: exitQuantity,
      }),
    // Stated so the surface can say where the entry came from: read from the
    // fills, or recovered from what the position realized.
    entryImplied: !enteredHere,
    exitPrice,
    realizedPnl: round.realizedPnl,
    fee: round.fee,
    // What reached the wallet. The exchange reports realized PnL before its own
    // commission, so the two are shown apart and the difference is stated.
    netPnl: round.realizedPnl - round.fee,
    fills: round.fills,
    open,
    partial: round.partial,
  })
}

// One contract's fills, in the order they happened. Exposure is per contract: a
// BTC sell does not reduce an ETH long, and folding the two together would close
// rounds that never closed and mark open ones flat.
const foldContractFills = (fills) => {
  const rounds = []
  let round = null
  let running = 0n
  for (const entry of fills) {
    const buy = isBuy(entry.fill)
    let remaining = entry.atoms
    while (remaining > 0n) {
      if (round === null) {
        round = openRound(entry.fill, buy, remaining === entry.atoms)
        running = 0n
      }
      const increasing = buy === (round.positionSide === 'LONG')
      // A round that began by closing a position opened before this window has no
      // size of its own to run down, so it ends where its run of closing fills
      // ends rather than swallowing the next position that opens.
      if (round.partial && increasing) {
        rounds.push(finishRound(round, false))
        round = null
        continue
      }
      const held = running < 0n ? -running : running
      // Reducing more than the position holds closes it and opens the opposite
      // one with what is left over.
      const take = increasing || round.partial || remaining <= held ? remaining : held
      applyFill(round, {
        fill: entry.fill,
        atoms: take,
        price: entry.price,
        share: Number(take) / Number(entry.atoms),
        increasing,
      })
      remaining -= take
      if (!round.partial) {
        running += buy ? take : -take
        if (running === 0n) {
          rounds.push(finishRound(round, false))
          round = null
        }
      }
    }
  }
  if (round !== null) rounds.push(finishRound(round, !round.partial && running !== 0n))
  return rounds
}

// Newest first, the way every other history table in the desk is read. A round
// that is still open sorts by its latest fill, so the position just worked on is
// the one at the top whichever contract it is on.
const newestFirst = (left, right) => (right.closeTime - left.closeTime)
  || (right.openTime - left.openTime)
  || (left.symbol < right.symbol ? -1 : left.symbol > right.symbol ? 1 : 0)

export const buildFuturesTradeRounds = (trades) => {
  const byContract = new Map()
  for (const fill of Array.isArray(trades) ? trades : []) {
    const atoms = toAtoms(fill?.quantity)
    const price = Number(fill?.price)
    if (atoms === null || atoms <= 0n || !Number.isFinite(price) || price <= 0) continue
    const symbol = symbolOf(fill)
    if (!byContract.has(symbol)) byContract.set(symbol, [])
    byContract.get(symbol).push({ fill, atoms, price })
  }
  const rounds = []
  for (const fills of byContract.values()) {
    fills.sort((left, right) => (toNumber(left.fill.time) - toNumber(right.fill.time))
      || (toNumber(left.fill.id) - toNumber(right.fill.id)))
    rounds.push(...foldContractFills(fills))
  }
  return rounds.sort(newestFirst)
}

export default buildFuturesTradeRounds
