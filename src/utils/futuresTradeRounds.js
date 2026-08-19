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

// One-way accounts report `BOTH`; a hedge account names the leg the fill belongs
// to, and its two legs are two positions on one contract.
const legOf = fill => String(fill?.positionSide ?? 'BOTH').toUpperCase()

// `closing` says this round begins by closing a position opened before this
// window of fills, whose entry price is therefore not in the data. Its leg is the
// one being closed, not the side of the fill — a BUY that closes closed a short.
//
// `fromFlat` records whether the walk actually saw this round start from no
// position at all. The first round of a contract did not — the window of fills
// begins wherever the read reached, and the operator may already have been in
// the trade — and neither did one that follows a round closing a position older
// than the window.
const openRound = (fill, buy, closing, fromFlat) => ({
  symbol: symbolOf(fill),
  // Trade ids are numbered per contract, so two symbols can hand out the same
  // one: the symbol is part of the identity, not decoration.
  key: `${symbolOf(fill)}:${fill?.id ?? fill?.orderId ?? 'round'}:${toNumber(fill?.time)}`,
  positionSide: closing === buy ? 'SHORT' : 'LONG',
  openTime: toNumber(fill?.time),
  closeTime: toNumber(fill?.time),
  entryAtoms: 0n,
  entryNotional: 0,
  // What the units still held were entered at, kept the way the exchange keeps
  // it: adding moves the average, closing does not move it at all. This is not
  // what the round reports — that is the average over everything it ever
  // entered, and it is the figure that makes exit minus entry times size come
  // to the realized PnL of the whole round. But it is the only average a
  // single fill's realized PnL can be checked against, because that is what
  // the exchange settled it against.
  heldAtoms: 0n,
  heldEntry: 0,
  exitAtoms: 0n,
  exitNotional: 0,
  realizedPnl: 0,
  fee: 0,
  fills: 0,
  partial: closing,
  fromFlat,
  leg: legOf(fill),
  // A zero-PnL first fill can be an opening or a break-even close when the
  // bounded read did not witness flat. Keep that uncertainty only until the
  // first reducing fill supplies evidence; it must never leak across a leg.
  ambiguousWindowEdge: !closing && !fromFlat && toNumber(fill?.realizedPnl) === 0,
  edgePhase: null,
  aggregateEntryImplied: false,
})

// Whether the fill a round is about to open on is closing a position opened
// before this window. Realized PnL says so whenever there is any: an opening fill
// realizes nothing.
//
// Nothing is the one answer it cannot settle. A close at exactly the position's
// own average entry realizes nothing either, and at a window edge — where the
// position's opening fills are not in hand to size it — the two are the same row
// of data. Read as an opening fill it invents a position in the opposite
// direction; every fill after it on that side then reads as adding to the
// invention, an increase carries no realized PnL, and the real close leaves the
// review taking its profit with it.
//
// The fills that follow settle what the fill itself cannot. Inside a run on one
// side the position only moves one way, so a later fill in that run realizing
// anything at all proves the run is reducing a position rather than building one
// — and a position being reduced that the walk never saw opened was opened before
// this window. The run ends at the first fill on the other side, or on another
// position leg: in a hedge account two sells in a row can be one position opening
// and another closing, and that is a different reading of the same two rows.
const opensByClosing = (fills, from, fromFlat) => {
  const opener = fills[from].fill
  if (toNumber(opener?.realizedPnl) !== 0) return true
  // The walk has seen this contract flat, so there is no older position left to
  // close and no ambiguity to settle.
  if (fromFlat) return false
  const buy = isBuy(opener)
  const leg = legOf(opener)
  for (let index = from + 1; index < fills.length; index += 1) {
    const next = fills[index].fill
    if (isBuy(next) !== buy || legOf(next) !== leg) return false
    if (toNumber(next?.realizedPnl) !== 0) return true
  }
  return false
}

// A reducing fill larger than the round is holding has two readings: the
// position flipped, or it was bigger than this window of fills shows and the
// excess is closing what was open before the window began. The exchange settles
// it — realized PnL is reported per fill and against the position's own entry,
// so a flip realizes exactly what closing the part the walk can see would
// realize. Anything else means more was closed than the walk knows about.
const flipIsConsistent = (round, { fill, held, price }) => {
  const size = Number(fromAtoms(held))
  const entryPrice = round.heldEntry
  if (!(size > 0) || !(entryPrice > 0)) return false
  const flipPnl = (round.positionSide === 'SHORT' ? entryPrice - price : price - entryPrice) * size
  // One per cent of what the closing part is worth: realized PnL is exact
  // arithmetic on both sides of this comparison, and the slack is only there so
  // that a rounded price cannot decide it.
  const tolerance = Math.abs(price * size) * 0.01
  return Math.abs(toNumber(fill.realizedPnl) - flipPnl) <= tolerance
}

// The tentative round treated the window-edge sells as a short entry (or buys
// as a long entry). Later evidence says they were instead exits from the real,
// older position. Move their already-counted quantity and notional across in
// place: fills and fees stay on the same round and are therefore counted once.
const restartAmbiguousWindowEdgeRound = (round) => {
  round.positionSide = round.positionSide === 'SHORT' ? 'LONG' : 'SHORT'
  round.exitAtoms += round.entryAtoms
  round.exitNotional += round.entryNotional
  round.entryAtoms = 0n
  round.entryNotional = 0
  round.heldAtoms = 0n
  round.heldEntry = 0
  round.partial = true
  round.ambiguousWindowEdge = false
  round.edgePhase = 'adding-after-edge-close'
  round.aggregateEntryImplied = true
}

const applyFill = (round, { fill, atoms, price, share, increasing }) => {
  const size = Number(fromAtoms(atoms))
  if (increasing) {
    round.entryAtoms += atoms
    round.entryNotional += size * price
    // Averaged against what is still held, not against everything ever entered.
    // A position scaled out of and back into drifts between the two, and the
    // check above compares a single fill's realized PnL — which the exchange
    // settled against this one — so it has to use this one.
    const heldSize = Number(fromAtoms(round.heldAtoms))
    round.heldEntry = heldSize + size > 0
      ? ((round.heldEntry * heldSize) + (price * size)) / (heldSize + size)
      : price
    round.heldAtoms += atoms
  } else {
    round.exitAtoms += atoms
    round.exitNotional += size * price
    // The whole of a fill's realized PnL belongs to the part of it that reduced
    // the position; a fill that closes one position and opens the opposite one
    // realized all of it on the way out.
    round.realizedPnl += toNumber(fill.realizedPnl)
    // Only the quantity is given back. `heldEntry` is deliberately left where it
    // was: with nothing held it describes nothing, and the next entry above
    // multiplies it by a `heldSize` of zero, so the stale figure cannot reach an
    // average. Clearing it would read as though something depended on it.
    round.heldAtoms = round.heldAtoms > atoms ? round.heldAtoms - atoms : 0n
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
  const quantity = Number(fromAtoms(quantityAtoms))
  const exitPrice = exitQuantity > 0 ? round.exitNotional / exitQuantity : null
  const enteredHere = entryQuantity > 0
  const entryPrice = round.aggregateEntryImplied || !enteredHere
    ? impliedEntryPrice({
      positionSide: round.positionSide,
      exitPrice,
      realizedPnl: round.realizedPnl,
      quantity: exitQuantity,
    })
    : round.entryNotional / entryQuantity
  return Object.freeze({
    key: round.key,
    symbol: round.symbol,
    positionSide: round.positionSide,
    openTime: round.openTime,
    closeTime: round.closeTime,
    quantity: fromAtoms(quantityAtoms),
    // What the position was worth, in the currency it settles in. A contract
    // count is only a size once you also know the price of the contract, and a
    // desk that sizes every order in USDT cannot compare 237 518 BMT against
    // 5 210 BEAT without doing that arithmetic by hand. Valued at the entry: the
    // exit is the entry plus the realized PnL, which the row states beside it.
    notional: entryPrice === null ? null : quantity * entryPrice,
    entryPrice,
    // Stated so the surface can say where the entry came from: read from the
    // fills, or recovered from what the position realized.
    entryImplied: round.aggregateEntryImplied || !enteredHere,
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
  // The walk has not seen a flat position yet: the contract's first round may
  // have been open before these fills begin.
  let openedFromFlat = false
  for (let index = 0; index < fills.length; index += 1) {
    const entry = fills[index]
    const buy = isBuy(entry.fill)
    let remaining = entry.atoms
    while (remaining > 0n) {
      if (round === null) {
        // Only a whole fill can be closing. The leftover of one that flipped the
        // position is known to be opening, and its fill's realized PnL was made
        // on the way out of the position it just closed.
        const whole = remaining === entry.atoms
        round = openRound(entry.fill, buy,
          whole && opensByClosing(fills, index, openedFromFlat), openedFromFlat)
        openedFromFlat = false
        running = 0n
      }
      let increasing = buy === (round.positionSide === 'LONG')
      const held = running < 0n ? -running : running
      if (round.ambiguousWindowEdge) {
        if (legOf(entry.fill) !== round.leg) {
          // A hedge leg is independent evidence about another position.
          round.ambiguousWindowEdge = false
        } else if (!increasing) {
          const reducing = remaining < held ? remaining : held
          const disproved = toNumber(entry.fill.realizedPnl) === 0
            && reducing > 0n
            && !flipIsConsistent(round, {
              fill: entry.fill,
              held: reducing,
              price: entry.price,
            })
          if (disproved) {
            restartAmbiguousWindowEdgeRound(round)
            running = 0n
            increasing = true
          } else {
            // The first reduction agreed with the tentative position (including
            // a genuine break-even reduction), so this was a real opening.
            round.ambiguousWindowEdge = false
          }
        }
      }
      // A round that began by closing a position opened before this window has no
      // size of its own to run down, so it ends where its run of closing fills
      // ends rather than swallowing the next position that opens. Unless it is
      // a restarted edge round still holding some of what it added: that
      // position is live, and more entry is more of it.
      if (round.partial && increasing && round.edgePhase !== 'adding-after-edge-close'
        && round.heldAtoms === 0n) {
        rounds.push(finishRound(round, false))
        round = null
        continue
      }
      // The re-close exists to take back what the restarted round added, and
      // whatever of the older position the window can still see. Once nothing
      // it added is held, a further reducing fill is indistinguishable from a
      // new position opening, so it is not absorbed on faith: the round ends
      // and the fill is read on its own evidence. Absorbed anyway, a genuinely
      // new short was folded into a closed long as extra exited contracts, and
      // the short's own round was left holding only its closing fill.
      if (!increasing && round.edgePhase === 'reclosing' && round.heldAtoms === 0n) {
        rounds.push(finishRound(round, false))
        round = null
        continue
      }
      // The position was open before this window began: what looked like a flip
      // is the rest of it being closed. Absorb the whole fill instead, and let
      // the entry come from the realized PnL — which states the position's true
      // average entry, where the fills in hand only state part of it. Read as a
      // flip, this invented a position in the opposite direction, priced at both
      // ends, and filed it in the closed-position review beside real ones.
      if (!increasing && !round.partial && !round.fromFlat && remaining > held
        && !flipIsConsistent(round, { fill: entry.fill, held, price: entry.price })) {
        round.partial = true
        round.entryAtoms = 0n
        round.entryNotional = 0
      }
      if (!increasing && round.edgePhase === 'adding-after-edge-close') {
        round.edgePhase = 'reclosing'
      }
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
          // The walk has now seen the position reach flat, so whatever opens
          // next is a position it can size — and a later fill that reduces past
          // it really did flip.
          openedFromFlat = true
        }
      }
    }
  }
  if (round !== null) {
    // A restarted edge round holding any of what it added is a live position:
    // published closed, it filed a phantom closed round in the review while
    // the operator was still in the trade, and the added size was held
    // nowhere. `heldAtoms` is exactly that size — only entries raise it and
    // only the restart path leaves `partial` set with entries behind it.
    const holdingRestartedAdds = round.edgePhase !== null && round.heldAtoms > 0n
    rounds.push(finishRound(round, holdingRestartedAdds || (!round.partial && running !== 0n)))
  }
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
