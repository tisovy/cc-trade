import { memo, useMemo, useState } from 'react'
import { formatSignedUsdt } from '../../../utils/futuresOrderPresentation.js'
import { buildFuturesTradeRounds } from '../../../utils/futuresTradeRounds.js'
import {
  formatCompactUsdt,
  formatExchangePrice,
  formatPriceOrAbsent,
  formatUsdtAmount,
} from '../../../utils/futuresPriceFormat.js'
import { exactFuturesDeskTime, formatFuturesDeskTime } from '../../../utils/futuresDeskTime.js'

const EMPTY_ROWS = Object.freeze([])
const EMPTY_TICKS = Object.freeze({})
const HIDDEN_ORDER_HISTORY_STATUSES = new Set(['CANCELED', 'CANCELLED'])

const sideTone = side => (String(side).toUpperCase() === 'SELL' ? 'sell' : 'buy')

const positiveNumber = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

const exactDerivedUsdt = value => value.toFixed(8).replace(/\.?0+$/, '')

const describeFilledUsdt = (order) => {
  const reported = positiveNumber(order?.quoteQty)
  if (reported !== null) {
    return {
      value: reported,
      exact: String(order.quoteQty).trim(),
      derived: false,
    }
  }
  const executed = positiveNumber(order?.executedQty)
  const average = positiveNumber(order?.averagePrice)
  if (executed === null || average === null) return null
  const value = executed * average
  return {
    value,
    exact: exactDerivedUsdt(value),
    derived: true,
  }
}

const formatFilledUsdt = value => (
  Math.abs(value) >= 10_000 ? formatCompactUsdt(value) : formatUsdtAmount(value, 2)
)

// What the order was placed for, as against what it executed. It never takes a
// column — the column states what happened — but a review of an order that did
// nothing is unreadable without it, so it rides along on the element.
const describeOrderedUsdt = (order) => {
  const original = positiveNumber(order?.origQty)
  if (original === null) return null
  const at = positiveNumber(order?.price) ?? positiveNumber(order?.averagePrice)
  return at === null ? null : original * at
}

// What became of the order, in the desk's own words, with the exchange's word
// kept on the element.
//
// The question the review exists for is "did my orders do anything", and the
// executed quantity answers it more directly than the status does: an order the
// exchange expired after filling four fifths of it did plenty. So the fill leads
// and the status is what is consulted when the fill is nothing.
const ENDED_OUTCOME_LABELS = Object.freeze({
  NEW: 'Open',
  PENDING_NEW: 'Open',
  PENDING_CANCEL: 'Open',
  PARTIALLY_FILLED: 'Open',
  FILLED: 'Filled',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  EXPIRED_IN_MATCH: 'Expired',
})

const describeOrderOutcome = (order) => {
  const status = String(order?.status ?? '').trim().toUpperCase()
  const executed = positiveNumber(order?.executedQty)
  const original = positiveNumber(order?.origQty)
  if (executed !== null && original !== null && executed >= original) {
    return { label: 'Filled', tone: 'filled', executed: true, status }
  }
  if (executed !== null) {
    // Rounded towards the nearest whole per cent, but never to 0 or 100: a fill
    // that happened must not read as one that did not, and a fill that is still
    // running must not read as one that finished.
    const share = original === null ? null : (executed / original) * 100
    const percent = share === null
      ? null
      : Math.min(99, Math.max(1, Math.round(share)))
    return {
      label: percent === null ? 'Part' : `Part ${percent}%`,
      tone: 'part',
      executed: true,
      status,
    }
  }
  const label = ENDED_OUTCOME_LABELS[status] ?? 'Ended'
  return {
    label,
    tone: label === 'Open' ? 'open' : 'dead',
    executed: false,
    status,
  }
}

// The exchange's order types are as long as eighteen characters and the track
// that holds them is eighty pixels. Each is stated in a form that fits, and the
// exchange's own word stays on the element.
const SHORT_ORDER_TYPES = Object.freeze({
  LIMIT: 'LIMIT',
  MARKET: 'MARKET',
  STOP: 'STOP LMT',
  STOP_MARKET: 'STOP MKT',
  STOP_LOSS: 'STOP LMT',
  STOP_LOSS_LIMIT: 'STOP LMT',
  TAKE_PROFIT: 'TP LMT',
  TAKE_PROFIT_MARKET: 'TP MKT',
  TAKE_PROFIT_LIMIT: 'TP LMT',
  TRAILING_STOP_MARKET: 'TRAIL',
  LIMIT_MAKER: 'MAKER',
})

const shortOrderType = (type) => {
  const exchangeType = String(type ?? '').trim().toUpperCase()
  return SHORT_ORDER_TYPES[exchangeType] ?? (exchangeType === '' ? '—' : exchangeType)
}

// The day a row belongs to, so a heading can state it once instead of every row
// switching its own format to say it. Keyed on the local day, because that is
// the day the operator traded in.
const dayKeyOf = (timestamp) => {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

const dayLabelOf = (timestamp) => {
  const date = new Date(timestamp)
  const today = new Date()
  return dayKeyOf(timestamp) === dayKeyOf(today.getTime())
    ? 'Today'
    : date.toLocaleDateString([], { day: '2-digit', month: '2-digit' })
}

// Every row shows its time of day; the day above it is the heading. The whole
// stamp stays on the element either way.
const rowTimeOf = (timestamp) => {
  const usable = Number.isSafeInteger(timestamp) && timestamp > 0
  return usable
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—'
}

// Rows in the order they are read, cut into one group per day. Newest first is
// the only order a session review is read in, and the reading arrives that way,
// so this only cuts — it never re-sorts.
//
// A day is a group of rows and not a row of its own: a heading that answered to
// `role="row"` would be counted among the orders by anything reading the table,
// which is exactly what a reader must not do with it.
const groupRowsByDay = (rows, timeOf) => {
  const groups = []
  for (const row of rows) {
    const time = Number(timeOf(row))
    const key = Number.isFinite(time) && time > 0 ? dayKeyOf(time) : 'unknown'
    const open = groups.length === 0 ? null : groups[groups.length - 1]
    if (open === null || open.key !== key) {
      groups.push({
        key,
        label: key === 'unknown' ? 'Undated' : dayLabelOf(time),
        rows: [row],
      })
      continue
    }
    open.rows.push(row)
  }
  return groups
}

const OUTCOME_FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'filled', label: 'Filled' },
  { id: 'unfilled', label: 'Unfilled' },
])

// What happened, and what it cost. Realized PnL is the number a trader reviews
// a session with, so it is the one column that never abbreviates its sign.
//
// The history spans the account, not the contract on screen: a trader reviews the
// session they had, and half of it was on the pairs they have since switched away
// from. Every row therefore names its contract and is priced at that contract's
// own tick, and the selected one is only tinted rather than being all there is.
export const FuturesHistoryPanel = ({
  view,
  symbol,
  history = null,
  tickSizes = EMPTY_TICKS,
  onSymbolChange,
}) => {
  // Narrowing is local to the reading already held: it issues no read, and the
  // scope statement beneath the table keeps describing the read rather than what
  // is left of it after a filter.
  const [outcomeFilter, setOutcomeFilter] = useState('all')
  const [contractOnly, setContractOnly] = useState(false)
  const status = history?.status ?? 'idle'
  const heldOrders = Array.isArray(history?.orders) ? history.orders : EMPTY_ROWS
  // Cancellation still belongs to the held reading: retaining it keeps the
  // cursor honest and prevents every refresh from rediscovering the same row.
  // It is only presentation noise in the operator's order review.
  const orders = useMemo(() => heldOrders.filter((order) => {
    const orderStatus = String(order?.status ?? '').trim().toUpperCase()
    return !HIDDEN_ORDER_HISTORY_STATUSES.has(orderStatus)
  }), [heldOrders])
  const trades = Array.isArray(history?.trades) ? history.trades : EMPTY_ROWS
  const narrowedOrders = useMemo(() => orders.filter((order) => {
    if (contractOnly && order?.symbol !== symbol) return false
    if (outcomeFilter === 'all') return true
    const executed = positiveNumber(order?.executedQty) !== null
    return outcomeFilter === 'filled' ? executed : !executed
  }), [contractOnly, orders, outcomeFilter, symbol])
  // How wide the read actually was. An empty table means "nothing here" only if
  // the operator knows what was looked at — the backend reads a bounded set of
  // contracts, so the count says which claim is being made.
  // What the operator traded is a position, not an execution: one market close
  // arrives as five fills in the same second, and five rows of a sixth of the
  // PnL each is not the number anybody reviews a session with.
  //
  // And this is the log of positions that are *finished*: entered, exited, and
  // what came of it. A position still running has no exit and no result, so it
  // belongs to the live positions table above, not to a history — listing it
  // here put half-empty rows among the closed ones and read as noise.
  //
  // Folded once per set of fills rather than once per render. The read is now a
  // thousand fills per contract across twelve contracts, and this panel
  // re-renders whenever a contract config arrives.
  const rounds = useMemo(() => (
    view === 'tradeHistory'
      ? buildFuturesTradeRounds(trades).filter(round => !round.open && round.exitPrice !== null)
      : EMPTY_ROWS
  ), [trades, view])
  const groupedOrders = useMemo(
    () => groupRowsByDay(narrowedOrders, order => order?.time),
    [narrowedOrders],
  )
  const groupedRounds = useMemo(
    () => groupRowsByDay(rounds, round => round?.closeTime),
    [rounds],
  )
  // A reading exists, whatever the read is doing now. Everything below renders
  // from it: a refresh in flight and a refresh that failed both leave the rows
  // the operator was reading exactly where they were.
  const held = history?.readAt !== null && history?.readAt !== undefined
  const folded = view === 'tradeHistory'
    ? (history?.foldedTrades?.length ?? 0)
    : (history?.foldedOrders?.length ?? 0)
  const read = Array.isArray(history?.symbols) ? history.symbols.length : 0
  const traded = Number.isSafeInteger(history?.discovered) ? history.discovered : 0
  const scope = read > 0
    ? ` across the ${read} contract${read === 1 ? '' : 's'} read`
    : ' in this window'
  // What the list does not cover. A review that is bounded and does not say so is
  // read as complete — the operator looked for two days of losses, found none, and
  // had no way to tell the difference between "there were none" and "they are on
  // the contracts this read dropped, or older than the fills it reached".
  //
  // It describes the read, so it is given the whole reading rather than what a
  // filter left of it: narrowing to one contract does not narrow what was read.
  const reach = (rows) => {
    const oldest = rows.reduce((earliest, row) => {
      const time = Number(row?.time)
      return Number.isFinite(time) && time > 0 && (earliest === null || time < earliest)
        ? time
        : earliest
    }, null)
    if (rows.length === 0) return null
    const contracts = traded > read
      ? `${read} of ${traded} contracts read`
      : `${read} contract${read === 1 ? '' : 's'} read`
    return (
      <p className="futures-workstation-history-reach">
        {contracts}
        {oldest === null ? '' : `, back to ${exactFuturesDeskTime(oldest)}`}
        {/* The count above is of the contracts the desk found. Where the search
            for them failed or ran out of pages, it is not known to be all of
            them, and a bounded number stated flatly reads as a total. */}
        {history?.discoveryComplete === false ? ' · more may have been traded' : ''}
        {/* Entries the stream added since. They widen the list without widening
            the read, and the count above describes the read — so they are stated
            separately rather than folded into a claim nobody made. */}
        {folded > 0 ? ` · ${folded} added since` : ''}
      </p>
    )
  }
  // A read that is in flight, or one that failed on top of a reading already
  // held. Neither may take the rows away: the operator is reading them.
  const notice = status === 'refreshing'
    ? (
      <p className="futures-workstation-history-notice" role="status">
        Re-reading the account…
      </p>
    )
    : held && history?.error
      ? (
        <p className="futures-workstation-history-notice is-error" role="alert">
          {history.error.message ?? `Re-read failed (${history.error.code ?? 'UNKNOWN'}).`}
          {' Showing the reading taken '}
          {formatFuturesDeskTime(history.readAt)}
          .
        </p>
      )
      : null
  const tickOf = rowSymbol => tickSizes[rowSymbol] ?? null
  const symbolCell = (rowSymbol) => {
    const name = typeof rowSymbol === 'string' && rowSymbol.length > 0 ? rowSymbol : '—'
    return (
      <span role="cell">
        {typeof onSymbolChange === 'function' && name !== '—' ? (
          <button
            type="button"
            className="futures-workstation-dock-symbol"
            aria-label={`Show ${name}`}
            onClick={() => onSymbolChange(name)}
          >
            {name}
          </button>
        ) : name}
      </span>
    )
  }
  const rowClass = (base, tone, rowSymbol) => (
    `futures-workstation-dock-row ${base} is-${tone}${rowSymbol === symbol ? ' is-current-symbol' : ''}`
  )
  // The day states itself once above the rows it holds. It is the group's own
  // name, so a reader that walks the table by rows walks orders only.
  const dayGroup = (group, renderRow) => (
    <div className="futures-workstation-dock-daygroup" role="rowgroup" aria-label={group.label} key={group.key}>
      <p className="futures-workstation-dock-day" aria-hidden="true">{group.label}</p>
      {group.rows.map(renderRow)}
    </div>
  )

  // Nothing has ever been read: this is the one case where an empty panel is
  // honest, and the one case where a failure is all there is to show.
  if (!held) {
    if (status === 'error') {
      return (
        <p className="futures-workstation-empty" role="alert">
          {history?.error?.message ?? `History unavailable (${history?.error?.code ?? 'UNKNOWN'}).`}
        </p>
      )
    }
    return (
      <p className="futures-workstation-empty" role="status">
        {status === 'loading' ? 'Loading account history…' : 'Open history to load it.'}
      </p>
    )
  }

  if (view === 'tradeHistory') {
    if (rounds.length === 0) {
      return (
        <>
          {notice}
          <p className="futures-workstation-empty">No closed positions{scope}.</p>
        </>
      )
    }
    return (
      <>
        {notice}
        <div className="futures-workstation-dock-table" role="table" aria-label="Position history">
          {/* Seven columns, not eight: the fee is a component of the result rather
              than a reading of its own, so it moved into the PnL cell's title — the
              column it was crowding is the only one this panel exists for. */}
          <div className="futures-workstation-dock-row is-head is-rounds" role="row">
            <span role="columnheader">Symbol</span>
            <span role="columnheader">Closed</span>
            <span role="columnheader">Side</span>
            <span role="columnheader">Size</span>
            <span role="columnheader">Entry</span>
            <span role="columnheader">Exit</span>
            <span role="columnheader">Realized PnL</span>
          </div>
          {groupedRounds.map(group => dayGroup(group, (round) => {
            const tone = round.realizedPnl === 0
              ? 'flat'
              : round.realizedPnl > 0 ? 'positive' : 'negative'
            const leg = round.positionSide === 'LONG' ? 'buy' : 'sell'
            return (
              <div className={rowClass('is-rounds', leg, round.symbol)} role="row" key={round.key}>
                {symbolCell(round.symbol)}
                {/* A closed position is filed under the day it closed on, which the
                    heading above states; the row shows the time of day, and the whole
                    span, open to close, stays on the element. */}
                <span role="cell" title={roundSpan(round)}>{rowTimeOf(round.closeTime)}</span>
                <span role="cell" className={`futures-workstation-dock-side is-${leg}`}>
                  {round.positionSide}
                </span>
                {/* Sized in USDT, like every other size on this desk. The contract
                    count is what the exchange worked in, so it stays exact on the
                    element rather than taking the column. */}
                <span
                  role="cell"
                  title={`${round.quantity} contracts · ${round.fills} fill${round.fills === 1 ? '' : 's'}`}
                >
                  {formatCompactUsdt(round.notional)}
                </span>
                {/* A position opened before this window of trades still has a knowable
                    entry: the exchange's realized PnL states it exactly. The row says
                    where the number came from rather than showing a dash. */}
                <span
                  role="cell"
                  title={round.entryImplied
                    ? 'Opened before this window of trades — entry recovered from the realized PnL'
                    : undefined}
                >
                  {formatPriceOrAbsent(round.entryPrice, tickOf(round.symbol))}
                </span>
                <span role="cell">{formatPriceOrAbsent(round.exitPrice, tickOf(round.symbol))}</span>
                {/* The exchange's realized PnL is before its own commission, so the
                    fee and the net are both stated in the title. */}
                <span
                  role="cell"
                  className={`futures-workstation-dock-pnl is-${tone}`}
                  title={`${formatSignedUsdt(round.realizedPnl)} realized less ${formatUsdtAmount(round.fee, 4)} in fees is ${formatSignedUsdt(round.netPnl)} net`}
                >
                  <strong>{formatSignedUsdt(round.realizedPnl)}</strong>
                </span>
              </div>
            )
          }))}
        </div>
        {reach(trades)}
      </>
    )
  }

  if (orders.length === 0) {
    return (
      <>
        {notice}
        <p className="futures-workstation-empty">No orders{scope}.</p>
      </>
    )
  }

  // Narrowing acts on the held reading and issues no read, so the controls sit
  // above the table rather than beside the read controls in the dock header.
  const filters = (
    <div className="futures-workstation-history-filters" role="group" aria-label="Narrow the order review">
      {OUTCOME_FILTERS.map(filter => (
        <button
          type="button"
          key={filter.id}
          className="futures-workstation-history-filter"
          aria-pressed={outcomeFilter === filter.id}
          onClick={() => setOutcomeFilter(filter.id)}
        >
          {filter.label}
        </button>
      ))}
      <button
        type="button"
        className="futures-workstation-history-filter is-contract"
        aria-pressed={contractOnly}
        disabled={typeof symbol !== 'string' || symbol.length === 0}
        onClick={() => setContractOnly(previous => !previous)}
      >
        This contract
      </button>
    </div>
  )

  return (
    <>
      {notice}
      {filters}
      {/* Narrowing that leaves nothing is not an empty review, and the two must
          not look alike: the table would otherwise render as a bare header with
          the scope line beneath it still describing the whole read, which reads
          as "the account has nothing" rather than "your filter has nothing". */}
      {narrowedOrders.length === 0 ? (
        <p className="futures-workstation-empty" role="status">
          {`Nothing here matches. The review holds ${orders.length} order${
            orders.length === 1 ? '' : 's'} — widen the narrowing to reach them.`}
        </p>
      ) : (
      <div className="futures-workstation-dock-table" role="table" aria-label="Order history">
        {/* Six columns, not eight. The outcome leads because it is what the review
            exists to answer, and it is a chip rather than a word in the last
            column because at the width the dock leaves this panel a word in the
            last column is an ellipsis. The average price folded into the price
            beside it, which is where a reader was already comparing the two. */}
        <div className="futures-workstation-dock-row is-head is-order-history" role="row">
          <span
            role="columnheader"
            title="What became of the order. Each row carries the exchange's own status word."
          >
            Outcome
          </span>
          <span role="columnheader">Contract</span>
          <span role="columnheader">Time</span>
          <span
            role="columnheader"
            title="Order type. An exit badge marks a reduce-only order, which can only close a position."
          >
            Type
          </span>
          <span role="columnheader" title="Filled notional in USDT">Filled USDT</span>
          <span role="columnheader" title="The price the order named, or the average it filled at when the two differ">
            Price
          </span>
        </div>
        {groupedOrders.map(group => dayGroup(group, (order) => {
          const outcome = describeOrderOutcome(order)
          const filled = describeFilledUsdt(order)
          const ordered = describeOrderedUsdt(order)
          const quantities = `${order.executedQty} / ${order.origQty} contracts`
          const placedFor = ordered === null
            ? ''
            : ` · placed for ${formatUsdtAmount(ordered, 2)} USDT`
          const filledTitle = filled === null
            ? `${quantities} · executed USDT unavailable${placedFor}`
            : `${filled.exact} USDT${filled.derived ? ' · derived from executed quantity × average fill price' : ' · reported by the exchange'} · ${quantities}${placedFor}`
          const tick = tickOf(order.symbol)
          const orderPrice = positiveNumber(order.price)
          const averagePrice = positiveNumber(order.averagePrice)
          // One reading rather than two columns. The average is what the order
          // actually got, so it is what is shown whenever it differs from the
          // price the order named — marked as an average, with both on the
          // element. Compared as rendered, so a tick's worth of float noise is
          // not reported as a difference.
          const showsAverage = averagePrice !== null
            && (orderPrice === null
              || formatExchangePrice(orderPrice, tick) !== formatExchangePrice(averagePrice, tick))
          const priceTitle = !showsAverage
            ? undefined
            : orderPrice === null
              ? `No price was named — this is the average of ${order.executedQty} contracts filled`
              : `Placed at ${formatExchangePrice(orderPrice, tick)}, filled at ${formatExchangePrice(averagePrice, tick)}`
          const exchangeType = String(order.type ?? '').trim().toUpperCase()
          const shortType = shortOrderType(order.type)
          const typeTitle = [
            shortType === exchangeType || exchangeType === '' ? null : exchangeType,
            order.reduceOnly ? 'reduce-only — this order can only close a position' : null,
          ].filter(Boolean).join(' · ')
          const name = typeof order.symbol === 'string' && order.symbol.length > 0
            ? order.symbol
            : '—'
          return (
            <div
              className={`${rowClass('is-order-history', sideTone(order.side), order.symbol)}${
                outcome.executed ? '' : ' is-idle'}`}
              role="row"
              key={`${order.symbol}:${order.orderId}:${order.time}`}
            >
              {/* The exchange's own word is on the element whether or not the chip
                  generalized it: at 62.7px a status column was an ellipsis with
                  nothing behind it, and PARTIALLY_FILLED and EXPIRED_IN_MATCH both
                  rendered as the same unreadable stub. */}
              <span role="cell">
                <em
                  className={`futures-workstation-dock-outcome is-${outcome.tone}`}
                  title={outcome.status === '' ? undefined : outcome.status}
                >
                  {outcome.label}
                </em>
              </span>
              {/* The contract and the side it was taken on, read as one thing: two
                  tracks for them is a track the outcome does not get. */}
              <span role="cell" className="futures-workstation-dock-instrument" title={name}>
                {typeof onSymbolChange === 'function' && name !== '—' ? (
                  <button
                    type="button"
                    className="futures-workstation-dock-symbol"
                    aria-label={`Show ${name}`}
                    onClick={() => onSymbolChange(name)}
                  >
                    {name}
                  </button>
                ) : name}
                <em className={`futures-workstation-dock-side is-inline is-${sideTone(order.side)}`}>
                  {order.side}
                </em>
              </span>
              {/* The day is the heading above; this is the time within it. */}
              <span role="cell" title={exactFuturesDeskTime(order.time)}>{rowTimeOf(order.time)}</span>
              {/* `· RO` said nothing to a reader who did not already know it. What a
                  reduce-only order is, is an exit — it can only close a position —
                  and that is a word rather than two letters. */}
              <span role="cell" title={typeTitle === '' ? undefined : typeTitle}>
                {shortType}
                {order.reduceOnly ? (
                  <em className="futures-workstation-dock-exit">exit</em>
                ) : null}
              </span>
              <span role="cell" className="futures-workstation-dock-filled" title={filledTitle}>
                {filled === null ? '—' : formatFilledUsdt(filled.value)}
              </span>
              {/* A market order carries no limit price and an unfilled order no
                  average: the exchange reports 0 for both, and 0.000 in a price column
                  reads as a level rather than as an absence. */}
              <span role="cell" title={priceTitle}>
                {showsAverage
                  ? `≈${formatExchangePrice(averagePrice, tick)}`
                  : formatPriceOrAbsent(order.price, tick)}
              </span>
            </div>
          )
        }))}
      </div>
      )}
      {reach(orders)}
    </>
  )
}

// A round is a span, not a moment: the column shows where it started and the
// title shows how long it ran, including the case where it is still running.
function roundSpan(round) {
  const opened = exactFuturesDeskTime(round.openTime)
  if (opened === undefined) return undefined
  if (round.open) return `Opened ${opened} · still open`
  const closed = exactFuturesDeskTime(round.closeTime)
  return closed === undefined || closed === opened
    ? `Opened and closed ${opened}`
    : `${opened} → ${closed}`
}

export default memo(FuturesHistoryPanel)
