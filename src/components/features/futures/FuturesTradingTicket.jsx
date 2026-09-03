import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  calculateFuturesExitBudget,
  calculateFuturesNotionalForPercent,
  calculateFuturesNotionalPercent,
  deriveFuturesLimitOrderDraft,
  isFuturesDraftAmountWithinBudget,
  normalizeFuturesDraftPrice,
  quantizeFuturesNotionalUsdt,
} from '../../../utils/futuresOrderDraft.js'
import {
  describeFuturesAlgoTrigger,
  describeFuturesOrderIntent,
  describeFuturesPosition,
  describeFuturesPositionMargin,
  exitTitle,
  orderPresentationPrice,
  orderNotionalUsdt,
  orderWorkingQuantity,
  totalOrderNotionalUsdt,
  formatSignedPercent,
  formatSignedUsdt,
  futuresPnlReadingNote,
  formatUsdt,
} from '../../../utils/futuresOrderPresentation.js'
import { futuresOrderPriceIsMovable } from '../../../utils/futuresOrderDrag.js'
import { describeFuturesOrderConfirmation } from '../../../utils/futuresOrderConfirmation.js'
import { formatFuturesReadingAge } from '../../../utils/futuresPriceReading.js'
import { exactFuturesDeskTime } from '../../../utils/futuresDeskTime.js'
import { applyFuturesPositionValuation } from '../../../utils/futuresPositionMarks.js'
import { useFuturesPositionValuation } from '../../../hooks/useFuturesPositionValuation.js'
import {
  formatExchangePrice,
  formatPriceOrAbsent,
  formatUsdtAmount,
} from '../../../utils/futuresPriceFormat.js'
import {
  describeFuturesOrderAvailability,
  describeFuturesResourceAvailability,
  deriveFuturesReadiness,
  FUTURES_READINESS_CODES,
  isFuturesBalanceConfirmed,
} from '../../../utils/futuresReadiness.js'
import FuturesOrderConfirmation from './FuturesOrderConfirmation.jsx'
import FuturesReadingNotice from './FuturesReadingNotice.jsx'
import './FuturesProductionExecutionTicket.css'

const EXACT_POSITIVE_DECIMAL = /^(?:[1-9][0-9]*|0\.[0-9]*[1-9][0-9]*|[1-9][0-9]*\.[0-9]+)$/

// How old the balance on screen is, while nothing has confirmed it on the
// connection that is up now.
//
// A reconnect turns a ready balance stale and the number stays on screen —
// re-entering the workspace with a blank ticket is worse. But a figure of
// unknown age is what an order gets sized against, so the age is stated beside
// it rather than left to be inferred from a readiness badge.
//
// A leaf on purpose, exactly as the price age is: the count has to grow, and a
// tick a second has no business re-rendering a ticket that already re-renders on
// market data. It says nothing at all for a confirmed balance.
export const FuturesBalanceAge = ({ at }) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const age = formatFuturesReadingAge(at, now)
  return (
    <em className="futures-production-balance-age" role="status">
      {age === null ? 'unconfirmed' : `${age} old`}
    </em>
  )
}

const FuturesResourceAvailabilityNotice = ({ availability, label }) => {
  const message = availability.notice ?? availability.label
  if (message === null) return null
  const failed = availability.state === 'failed'
  return (
    <p role={failed ? 'alert' : 'status'} aria-label={label}>
      {message}
      {availability.reason === null ? null : <em> {availability.reason}</em>}
    </p>
  )
}

const ORDER_ACTIONS = Object.freeze([
  Object.freeze({
    key: 'LONG_ENTRY', side: 'BUY', positionSide: 'LONG', positionEffect: 'ENTRY', label: 'LONG entry',
  }),
  Object.freeze({
    key: 'LONG_EXIT', side: 'SELL', positionSide: 'LONG', positionEffect: 'EXIT', label: 'LONG exit',
  }),
  Object.freeze({
    key: 'SHORT_ENTRY', side: 'SELL', positionSide: 'SHORT', positionEffect: 'ENTRY', label: 'SHORT entry',
  }),
  Object.freeze({
    key: 'SHORT_EXIT', side: 'BUY', positionSide: 'SHORT', positionEffect: 'EXIT', label: 'SHORT exit',
  }),
])

const DRAFT_REASON_MESSAGES = Object.freeze({
  INVALID_DRAFT_INPUT: 'Enter a valid limit price and order size',
  BELOW_MINIMUM_QUANTITY: 'Size is below the Binance minimum quantity',
  ABOVE_MAXIMUM_QUANTITY: 'Size is above the Binance maximum quantity',
  BELOW_MINIMUM_NOTIONAL: 'Size is below the Binance minimum notional',
})

const SEND_FAILED_MESSAGE = 'Local backend connection unavailable — reconnect.'
const EMPTY_TICKS = Object.freeze({})
const RAW_POSITION_SIDES = new Set(['BOTH', 'LONG', 'SHORT'])

const isExactPositiveDecimal = value => (
  typeof value === 'string' && value.length <= 42 && EXACT_POSITIVE_DECIMAL.test(value)
)
const exactText = value => (typeof value === 'string' && value.length > 0 ? value : '—')

const findCurrentExitPosition = (positions, symbol, semanticSide) => (
  positions.find((position) => {
    if (position.symbol !== symbol || !RAW_POSITION_SIDES.has(position.positionSide)) return false
    const description = describeFuturesPosition(position)
    return description.positionSide === semanticSide
      && description.absoluteQuantity !== null
      && description.absoluteQuantity > 0
  }) ?? null
)

// Every contract on this desk settles in USDT, so the quote half of the name is
// the same four characters on every row of a column that has none to spare. The
// whole name stays on the cell and on every control that acts on the contract.
const contractLabel = (symbol) => {
  if (typeof symbol !== 'string' || symbol.length === 0) return '—'
  return symbol.length > 4 && symbol.endsWith('USDT') ? symbol.slice(0, -4) : symbol
}

// What the order is worth is what it is read against; the contract count is what
// the exchange works in, and it stays a hover away rather than taking a column.
const orderSizeTitle = (order) => {
  // What is still working, so the hover agrees with the value beside it: a
  // partly filled order rests at its remainder.
  const working = orderWorkingQuantity(order)
  return working !== null && working > 0 ? `${working} contracts` : undefined
}

const openOrderEditorFromKeyboard = (event, order, onOrderEdit) => {
  if (event.target !== event.currentTarget) return
  if (event.key !== 'Enter' && event.key !== ' ') return
  if (event.key === ' ') event.preventDefault()
  if (event.repeat) return
  const rowRect = event.currentTarget.getBoundingClientRect()
  onOrderEdit(order, {
    x: rowRect.left + (rowRect.width / 2),
    y: rowRect.top + (rowRect.height / 2),
  })
}

const FuturesTradingPositionCard = memo(({
  onPositionClose,
  position,
  snapshotAt,
  snapshotCoherent,
  snapshotConfirmed,
  store,
  tickSize,
}) => {
  const valuation = useFuturesPositionValuation(position, store, {
    snapshotAt,
    snapshotCoherent,
    snapshotConfirmed,
    // The card explains tape/mark disagreement, so it needs price changes from
    // both sources but not a render for clock-only freshness advances.
    presentationOnly: true,
  })
  const valuedPosition = useMemo(
    () => applyFuturesPositionValuation(position, valuation),
    [position, valuation],
  )
  const presentation = describeFuturesPosition(valuedPosition)
  const marginState = describeFuturesPositionMargin(valuedPosition)
  const priceOf = value => formatExchangePrice(value, tickSize)
  const hasPnl = valuation.unrealizedPnl !== null
  const hasRoe = valuation.roeComplete && valuation.roe !== null
  const source = valuation.source === 'live-price'
    ? valuation.basis === 'last-price'
      ? 'Live: what the contract last printed at'
      : 'Live: the exchange mark — no print since'
    : valuation.source === 'account-snapshot'
      ? `Account snapshot fallback${valuation.sourceAt === null
        ? ''
        : ` from ${exactFuturesDeskTime(valuation.sourceAt)}`}; no live price`
      : 'Valuation unavailable'
  return (
    <article
      className={`is-${presentation.tone}`}
      data-position-key={`${position.symbol}:${position.positionSide}`}
      data-valuation-source={valuation.source}
    >
      <header>
        <strong>{position.symbol}</strong>
        <span className={`futures-production-side is-${presentation.tone}`}>
          {presentation.positionSide}
        </span>
      </header>
      <div
        className={`futures-production-position-pnl is-${hasPnl ? presentation.pnlTone : 'absent'}`}
        title={`${source}${futuresPnlReadingNote(presentation, priceOf)}`}
      >
        <strong>{hasPnl ? `${formatSignedUsdt(valuation.unrealizedPnl)} USDT` : '— USDT'}</strong>
        <em>{hasRoe ? formatSignedPercent(valuation.roe) : '—'}</em>
      </div>
      {/* What the exchange itself is holding the position at, under its own
          name and never as the headline. The figure above is read at the price
          the contract is printing, because that is what the operator watches
          and what an exit fills near; this is the one the account agrees with,
          the one funding is charged on and the one liquidation is decided by.
          Shown only while the two are actually different readings. */}
      {valuation.basis !== 'last-price' || valuation.markScenario === null ? null : (
        <p
          className="futures-production-position-mark"
          title={`What the exchange values this position at on its own mark of ${
            priceOf(valuation.markScenario.price)}${
            valuation.markScenario.sourceAt === null
              ? ''
              : `, published ${exactFuturesDeskTime(valuation.markScenario.sourceAt)}`
          } — once a second, and the number the Binance app shows. Funding, margin and liquidation are all decided on it. The figure above is the same position at the price it last traded.`}
        >
          <em>On the exchange’s mark</em>
          <span>{formatSignedUsdt(valuation.markScenario.unrealizedPnl)} USDT</span>
        </p>
      )}
      <dl>
        <div><dt>Qty</dt><dd>{exactText(position.quantity)}</dd></div>
        <div><dt>Entry</dt><dd>{priceOf(position.entryPrice)}</dd></div>
        {/* The market header carries a `Last` of its own, restated on every
            repaint. This one is the print the figures above were computed at,
            restated no more often than the Aggregate trades timeout allows, so
            during a fast move the two can stand a fraction of a second apart.
            Same quantity, two cadences — said here so it does not read as two
            different prices. */}
        {valuation.basis === 'last-price' ? (
          <div
            title={'The price this position was valued at — the contract’s last print, '
              + 'restated at the rate the Aggregate trades timeout allows. The market '
              + 'header restates its own on every repaint, so the two can differ by '
              + 'that much during a fast move.'}
          >
            <dt>Last</dt>
            <dd>{priceOf(valuation.basisPrice)}</dd>
          </div>
        ) : null}
        <div><dt>Mark</dt><dd>{priceOf(valuation.markPrice)}</dd></div>
        <div><dt>Liq.</dt><dd>{priceOf(position.liquidationPrice)}</dd></div>
        <div>
          <dt>Margin</dt>
          <dd>
            {marginState.marginMode ? (
              <em className="futures-production-margin-mode">
                {marginState.marginMode === 'CROSS' ? 'CROSS' : 'ISO'}
              </em>
            ) : null}
            {formatUsdt(marginState.margin)}
          </dd>
        </div>
      </dl>
      <div>
        <button
          type="button"
          onClick={event => onPositionClose?.(position, {
            x: event.clientX,
            y: event.clientY,
          })}
        >
          Close position
        </button>
      </div>
    </article>
  )
})

const FuturesTradingTicket = ({
  state,
  selectedSymbol = 'BTCUSDT',
  selectedContract = null,
  tickSizes = EMPTY_TICKS,
  leverage = null,
  marginMode = null,
  onLeverageEdit,
  onMarginModeChange,
  draftPrice = null,
  draftPriceReading = null,
  gestureRequest = null,
  sizeRequest = null,
  onDraftPriceChange,
  onSymbolChange,
  onOrderEdit,
  onPositionClose,
}) => {
  const safeState = state ?? {}
  const balances = safeState.balances ?? null
  const balanceResource = safeState.accountResources?.balances ?? {
    status: balances === null ? 'loading' : 'ready',
    data: balances,
    lastSuccessfulAt: balances === null ? null : Date.now(),
    error: null,
  }
  const openOrders = Array.isArray(safeState.openOrders) ? safeState.openOrders : []
  const positions = Array.isArray(safeState.positions) ? safeState.positions : []
  const positionsResource = safeState.accountResources?.positions ?? null
  const positionsAvailability = describeFuturesResourceAvailability([positionsResource])
  const ordersAvailability = describeFuturesOrderAvailability(safeState.accountResources)
  const positionSizingReady = positionsResource === null
    ? Array.isArray(safeState.positions)
    : positionsResource.status === 'ready'
      || (positionsResource.status === 'loading'
        && Number.isFinite(positionsResource.lastSuccessfulAt))
  // The same question sizing asks: a reading being re-confirmed over a prior
  // success is still the reading on screen. The main process proves the leg
  // against its own newest reading; the ticket withholding an exit on
  // `ready` alone is what kept the operator in a position for the twenty-four
  // seconds an account pass took on 2026-09-02.
  const positionCommandReady = positionSizingReady
  const positionSnapshotUpdatedAt = Number.isSafeInteger(positionsResource?.updatedAt)
    ? positionsResource.updatedAt
    : null
  const positionSnapshotSuccessfulAt = Number.isSafeInteger(positionsResource?.lastSuccessfulAt)
    ? positionsResource.lastSuccessfulAt
    : null
  const positionSnapshotAt = positionSnapshotUpdatedAt ?? positionSnapshotSuccessfulAt
  const positionSnapshotCoherent = positionsResource === null && positions.length > 0
    ? true
    : positionSnapshotUpdatedAt !== null
      && positionSnapshotUpdatedAt === positionSnapshotSuccessfulAt
  const positionSnapshotConfirmed = positionSizingReady
    || positions.length > 0
    || positionSnapshotSuccessfulAt !== null
  const [tab, setTab] = useState('trade')
  // Sizing starts at zero, never at a share of the balance: a size the operator
  // never chose is a size they will not read on the confirmation either.
  const [sizePercent, setSizePercent] = useState(0)
  const [customNotionalUsdt, setCustomNotionalUsdt] = useState(null)
  const [localPrice, setLocalPrice] = useState('')
  const [feedback, setFeedback] = useState(null)
  const [pendingOrder, setPendingOrder] = useState(null)
  // What did not leave the renderer, held on the panel that tried to send it.
  const [unsentConfirmation, setUnsentConfirmation] = useState(null)
  // The rejection the ticket is showing, and the one it was last given.
  //
  // The hook clears `lastError` whenever an execution report arrives — including
  // a report about a completely different order — so a refusal of the order the
  // operator just sent could be wiped off the screen by an unrelated fill a
  // moment later. The ticket keeps the rejection it was handed and lets go of it
  // only when the operator dismisses it or sends something else.
  const [heldRejection, setHeldRejection] = useState(null)
  const [givenRejection, setGivenRejection] = useState(null)
  const handledGestureRef = useRef(null)
  const handledSizeRef = useRef(null)
  const feedbackSymbolRef = useRef(selectedSymbol)

  const price = typeof draftPrice === 'string' ? draftPrice : localPrice
  const updatePrice = (nextPrice) => {
    if (typeof onDraftPriceChange === 'function') onDraftPriceChange(nextPrice)
    else setLocalPrice(nextPrice)
  }

  const selectedContractTradable = selectedContract?.symbol === selectedSymbol
    && selectedContract?.tradable === true
  // A contract the catalog carries as live and perpetual, that the desk still
  // will not trade. Since 2026-08-28 the desk trades every contract it
  // catalogues, so this combination is a divergence guard that is expected
  // never to fire — but if the two spellings ever part ways again, the
  // readiness gate owes the operator that reason, not "select an active
  // contract".
  const selectedContractUntradableListing = selectedContract?.symbol === selectedSymbol
    && selectedContract?.tradable === false
    && selectedContract?.status === 'TRADING'
    && selectedContract?.contractType === 'PERPETUAL'
  const tickSize = selectedContract?.filters?.price?.tickSize
  const stepSize = selectedContract?.filters?.quantity?.stepSize
  const minQuantity = selectedContract?.filters?.quantity?.min
  const maxQuantity = selectedContract?.filters?.quantity?.max
  const minNotionalUsdt = selectedContract?.filters?.minimumNotional
  const tickOf = symbol => (
    tickSizes?.[symbol] ?? (symbol === selectedSymbol ? tickSize ?? null : null)
  )
  const hasFilters = isExactPositiveDecimal(tickSize)
    && isExactPositiveDecimal(stepSize)
    && isExactPositiveDecimal(minQuantity)
    && isExactPositiveDecimal(maxQuantity)
    && isExactPositiveDecimal(minNotionalUsdt)

  const availableUsdt = typeof balances?.USDT?.available === 'string'
    ? balances.USDT.available
    : null
  const sizingBudget = availableUsdt !== null && isExactPositiveDecimal(availableUsdt)
    ? availableUsdt
    : null
  // A balance being re-read is still the balance the desk holds: blanking the
  // size while the read is in flight is what made the panel flash on every
  // account refresh.
  const sizingReady = isFuturesBalanceConfirmed(balanceResource)
    && sizingBudget !== null
    && hasFilters
  // A balance the desk still shows but nothing has confirmed on this connection:
  // stale after a reconnect, or failed after having answered once. The figure
  // stays — the alternative is a blank ticket — so its age has to be stated.
  const balanceUnconfirmed = !isFuturesBalanceConfirmed(balanceResource)
    && Number.isFinite(balanceResource?.lastSuccessfulAt)
  // Whole USDT only: a slider that reports 66030.478842815 makes the operator
  // read noise instead of a size.
  const rawNotionalUsdt = sizingReady
    ? customNotionalUsdt ?? calculateFuturesNotionalForPercent(sizingBudget, sizePercent) ?? ''
    : ''
  const notionalUsdt = quantizeFuturesNotionalUsdt(rawNotionalUsdt) ?? rawNotionalUsdt
  const displayedSizePercent = customNotionalUsdt === null
    ? sizePercent
    : calculateFuturesNotionalPercent(customNotionalUsdt, sizingBudget) ?? 0

  // The leverage the account is actually set to, so the margin an entry will cost
  // is the exchange's arithmetic rather than a placeholder. Unknown falls back to
  // 1×, which overstates the cost — never understates it — and the reading says
  // so by showing no multiple beside it.
  const entryLeverage = Number.isSafeInteger(leverage) && leverage >= 1 ? leverage : null
  // Which mode the contract is in, as the exchange last reported it — never a
  // requested one, and never a default. Isolated caps a losing position at the
  // margin behind it; cross stands the whole wallet behind it. An operator
  // reading ISO on a contract the account carries in cross has the wrong idea
  // of what the next entry can cost them, and the exchange announces this
  // field on no stream: the only place it can come from is a read.
  const contractMarginMode = marginMode === 'ISOLATED' || marginMode === 'CROSSED'
    ? marginMode
    : null
  const deriveDraft = candidatePrice => deriveFuturesLimitOrderDraft({
    notionalUsdt,
    price: candidatePrice,
    tickSize,
    stepSize,
    minQuantity,
    maxQuantity,
    minNotionalUsdt,
    leverage: entryLeverage ?? 1,
  })
  const orderDraft = deriveDraft(price)
  const amountWithinBudget = isFuturesDraftAmountWithinBudget(notionalUsdt, sizingBudget)

  const tradingPaused = safeState.tradingPaused === true
  const readinessInput = {
    startupReady: safeState.startupReady !== false,
    connected: safeState.connected === true,
    selectedContractTradable,
    selectedContractUntradableListing,
    hasFilters,
    tradingPaused,
    balanceResource,
    availableUsdt,
    notionalUsdt,
    maxOrderNotionalUsdt: safeState.maxOrderNotionalUsdt,
  }
  const readiness = deriveFuturesReadiness(readinessInput)
  const sizingControlsReady = sizingReady && deriveFuturesReadiness({
    ...readinessInput,
    exposureIncreasing: false,
  }).ready
  // The size a submission is measured against is the size that submission
  // carries — the staged one when confirming an order staged earlier, the one on
  // the ticket otherwise. Measuring a staged order against the current ticket is
  // how a confirmation for one amount could be checked against another.
  const deriveSubmissionReadiness = (action, draft, sizeUsdt = notionalUsdt) => deriveFuturesReadiness({
    ...readinessInput,
    notionalUsdt: sizeUsdt,
    draftRequired: true,
    draftValid: draft.ok,
    amountWithinBudget: sizeUsdt === notionalUsdt
      ? amountWithinBudget
      : isFuturesDraftAmountWithinBudget(sizeUsdt, sizingBudget),
    exposureIncreasing: action.positionEffect === 'ENTRY',
  })
  const canSubmitAction = action => deriveSubmissionReadiness(action, orderDraft).ready

  // The condition, as a code for the record, beside the words for the operator.
  // A command withheld here never reaches the main process, so this is the only
  // place a line about it can come from.
  const resolveSubmitBlockCode = (
    action,
    draft,
    sizeUsdt = notionalUsdt,
    orderSymbol = selectedSymbol,
  ) => {
    if (!readiness.ready) return readiness.code
    if (!sizingReady) return 'SIZING_UNCONFIRMED'
    if (!isExactPositiveDecimal(sizeUsdt)) return 'SIZE_UNSET'
    if (!draft.ok) return `DRAFT_${String(draft.reason ?? 'INVALID').toUpperCase()}`
    const submissionReadiness = deriveSubmissionReadiness(action, draft, sizeUsdt)
    if (!submissionReadiness.ready) return submissionReadiness.code
    if (action.positionEffect === 'EXIT' && (
      !positionCommandReady
      || findCurrentExitPosition(positions, orderSymbol, action.positionSide) === null
    )) {
      return 'POSITION_UNCONFIRMED'
    }
    return 'SEND_FAILED'
  }
  const reportWithheld = (action, code, orderSymbol = selectedSymbol) => {
    safeState.reportWithheld?.({
      command: 'trade.placeOrder',
      code,
      symbol: orderSymbol,
      label: action?.label ?? null,
    })
  }

  const resolveSubmitBlockReason = (
    action,
    draft,
    sizeUsdt = notionalUsdt,
    orderSymbol = selectedSymbol,
  ) => {
    if (!readiness.ready) return readiness.reason
    if (!sizingReady) return 'No confirmed available USDT balance to size the order.'
    // Sizing starts at zero, so an unsized draft is the ordinary case, not a
    // broken contract: say so instead of blaming the exchange filters.
    if (!isExactPositiveDecimal(sizeUsdt)) return 'Order size is 0 — choose a size first.'
    if (!draft.ok) return DRAFT_REASON_MESSAGES[draft.reason] ?? 'Order draft is invalid.'
    const submissionReadiness = deriveSubmissionReadiness(action, draft, sizeUsdt)
    if (!submissionReadiness.ready) return submissionReadiness.reason
    if (action.positionEffect === 'EXIT' && (
      !positionCommandReady
      || findCurrentExitPosition(positions, orderSymbol, action.positionSide) === null
    )) {
      return `No current confirmed ${action.positionSide} position is available to close.`
    }
    return SEND_FAILED_MESSAGE
  }

  // Takes the draft to send rather than a price to derive one from. A caller
  // that staged an order hands back the object it staged, so the quantity that
  // reaches the exchange is the quantity that was read on the way in.
  const submitLimitOrder = (action, draft, {
    sizeUsdt = notionalUsdt,
    staged = false,
    symbol: orderSymbol = selectedSymbol,
  } = {}) => {
    const submissionReadiness = deriveSubmissionReadiness(action, draft, sizeUsdt)
    const currentExitPosition = action.positionEffect === 'EXIT' && positionCommandReady
      ? findCurrentExitPosition(positions, orderSymbol, action.positionSide)
      : null
    if (
      !submissionReadiness.ready
      || !draft.ok
      || typeof safeState.placeOrder !== 'function'
      || (action.positionEffect === 'EXIT' && currentExitPosition === null)
    ) {
      const reason = resolveSubmitBlockReason(action, draft, sizeUsdt, orderSymbol)
      reportWithheld(action, resolveSubmitBlockCode(action, draft, sizeUsdt, orderSymbol), orderSymbol)
      setFeedback({
        tone: 'ignored',
        title: `${action.label} NOT sent`,
        // A refused confirmation names the order it refused: the operator read
        // those numbers a moment ago, and nothing was quietly resized to fit.
        detail: staged && draft.ok
          ? `${reason} The confirmed ${draft.quantity} @ ${draft.price} was not sent and was not re-sized.`
          : reason,
      })
      return false
    }
    // The operator is issuing another command: the previous refusal has been
    // acted on, whether or not it was dismissed.
    setHeldRejection(null)
    const accepted = safeState.placeOrder({
      symbol: orderSymbol,
      side: action.side,
      orderType: 'LIMIT',
      price: draft.price,
      quantity: draft.quantity,
      ...(action.positionEffect === 'EXIT'
        ? { positionSide: currentExitPosition.positionSide, reduceOnly: true }
        : {}),
    })
    setFeedback(accepted
      ? null
      : { tone: 'ignored', title: `${action.label} NOT sent`, detail: SEND_FAILED_MESSAGE })
    return accepted
  }

  // Readiness is re-derived at this moment, not at the moment the order was
  // staged, so a balance or connection that lapsed while the panel was open
  // still blocks the send. The order itself is not re-derived: the panel showed
  // a quantity, and that quantity is what leaves. Deriving it again here read
  // the balance a second time, so a refresh landing between staging and Confirm
  // silently doubled an order the operator had already read and approved.
  // A panel that closes is this desk's way of saying "done", and it may only say
  // it when the command actually left the renderer. It used to close first and
  // send second, so a closed socket dismissed the confirmation exactly as a
  // delivered order did — with the numbers the operator had just approved gone
  // from the screen. The editor already worked this way; this is the same rule
  // on the surface that sends the most orders.
  const confirmPendingOrder = () => {
    if (!pendingOrder) return
    if (pendingOrder.symbol !== selectedSymbol) {
      setPendingOrder(null)
      setUnsentConfirmation(null)
      reportWithheld(pendingOrder.action, 'CONTRACT_CHANGED', pendingOrder.symbol)
      setFeedback({
        tone: 'ignored',
        title: `${pendingOrder.action.label} NOT sent`,
        detail: 'The selected contract changed, so the staged order was withdrawn.',
      })
      return
    }
    const sent = submitLimitOrder(pendingOrder.action, pendingOrder.draft, {
      sizeUsdt: pendingOrder.notionalUsdt,
      staged: true,
      symbol: pendingOrder.symbol,
    })
    if (sent === false) {
      setUnsentConfirmation(resolveSubmitBlockReason(
        pendingOrder.action,
        pendingOrder.draft,
        pendingOrder.notionalUsdt,
        pendingOrder.symbol,
      ))
      return
    }
    setUnsentConfirmation(null)
    setPendingOrder(null)
  }

  const cancelPendingOrder = () => {
    if (!pendingOrder) return
    setPendingOrder(null)
    setUnsentConfirmation(null)
    setFeedback(null)
  }

  const pendingExitPosition = pendingOrder?.action.positionEffect === 'EXIT'
    && positionSizingReady
    ? findCurrentExitPosition(
      positions,
      pendingOrder.symbol,
      pendingOrder.action.positionSide,
    )
    : null
  const pendingExitQuantity = typeof pendingExitPosition?.quantity === 'string'
    ? pendingExitPosition.quantity.replace(/^[+-]/, '')
    : Number.isFinite(pendingExitPosition?.quantity)
      ? String(Math.abs(pendingExitPosition.quantity))
      : null
  const pendingSizingMaximumUsdt = pendingOrder
    ? pendingOrder.action.positionEffect === 'ENTRY'
      ? (sizingReady ? sizingBudget : null)
      : calculateFuturesExitBudget({
        positionQuantity: pendingExitQuantity,
        price: pendingOrder.price,
        tickSize,
      })
    : null
  const pendingSizingPercent = pendingOrder && pendingSizingMaximumUsdt !== null
    ? pendingOrder.sizingReferenceUsdt === pendingSizingMaximumUsdt
      && Number.isSafeInteger(pendingOrder.requestedSizePercent * 2)
      ? pendingOrder.requestedSizePercent
      : calculateFuturesNotionalPercent(
        pendingOrder.notionalUsdt,
        pendingSizingMaximumUsdt,
      )
    : null
  const pendingSizingReadiness = pendingOrder?.resizedInConfirmation === true
    ? deriveSubmissionReadiness(
      pendingOrder.action,
      pendingOrder.draft,
      pendingOrder.notionalUsdt,
    )
    : null
  const pendingSizingReason = pendingOrder?.resizedInConfirmation === true
    ? pendingOrder.draft.ok
      ? pendingSizingReadiness?.ready ? null : pendingSizingReadiness?.reason
      : DRAFT_REASON_MESSAGES[pendingOrder.draft.reason] ?? 'Order draft is invalid.'
    : null

  const resizePendingOrder = (nextPercent) => {
    if (!pendingOrder || pendingSizingMaximumUsdt === null) return
    const nextNotionalUsdt = calculateFuturesNotionalForPercent(
      pendingSizingMaximumUsdt,
      nextPercent,
    )
    if (nextNotionalUsdt === null) return
    const nextDraft = deriveFuturesLimitOrderDraft({
      notionalUsdt: nextNotionalUsdt,
      price: pendingOrder.price,
      tickSize,
      stepSize,
      minQuantity,
      maxQuantity,
      minNotionalUsdt,
      leverage: entryLeverage ?? 1,
    })
    setUnsentConfirmation(null)
    // The size is one value, not two. Resizing on the confirmation used to move
    // only the pending order, so the rail went on showing the figure the
    // operator had left there — 17k on the panel while the order at the cursor
    // was for something else. The rail follows.
    //
    // The notional is carried back rather than the percent, because the two
    // panels measure percent against different things: the rail's slider is a
    // share of the available balance, and an exit's slider on the confirmation
    // is a share of the position being closed. The amount means the same on both.
    setCustomNotionalUsdt(nextNotionalUsdt)
    setPendingOrder(previous => previous ? {
      ...previous,
      draft: nextDraft,
      quantity: nextDraft.ok ? nextDraft.quantity : null,
      notionalUsdt: nextNotionalUsdt,
      requestedSizePercent: nextPercent,
      sizingReferenceUsdt: pendingSizingMaximumUsdt,
      resizedInConfirmation: true,
    } : previous)
  }

  // A gesture prepares the order; it does not send it.
  //
  // Alt+right ("exit LONG") and Ctrl+right ("enter SHORT") are the same SELL at
  // the same price for the same size, so a slipped modifier produces an order
  // that looks exactly right while doing the opposite thing to the position.
  // The operator confirms the consequence instead, in a panel at the cursor.
  useEffect(() => {
    if (!gestureRequest || handledGestureRef.current === gestureRequest.id) return
    handledGestureRef.current = gestureRequest.id
    const action = ORDER_ACTIONS.find(candidate => (
      candidate.side === gestureRequest.side
      && candidate.positionSide === gestureRequest.positionSide
      && candidate.positionEffect === gestureRequest.positionEffect
    ))
    if (!action) return
    const candidatePrice = normalizeFuturesDraftPrice(gestureRequest.price, tickSize)
      ?? gestureRequest.price
    const draft = deriveDraft(candidatePrice)
    // An order that cannot be sent is refused here, not staged and then refused
    // on confirmation: the operator learns the reason while the price is fresh.
    if (!draft.ok || !deriveSubmissionReadiness(action, draft).ready) {
      setPendingOrder(null)
      reportWithheld(action, resolveSubmitBlockCode(action, draft))
      setFeedback({
        tone: 'ignored',
        title: `${action.label} NOT sent`,
        detail: resolveSubmitBlockReason(action, draft),
      })
      return
    }
    setFeedback(null)
    setUnsentConfirmation(null)
    setPendingOrder({
      action,
      symbol: selectedSymbol,
      // The whole draft, not just its price: this object is what Confirm sends.
      draft,
      price: draft.price,
      quantity: draft.quantity,
      notionalUsdt,
      // The reading the price came off, frozen with the order it is staged for.
      // The age it states keeps counting; where the number came from does not
      // change because the market moved on afterwards.
      priceReading: gestureRequest.reading ?? null,
      anchor: gestureRequest.anchor ?? null,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gestureRequest])

  // A drag no longer amends anything. Picking an order up cancels it and the
  // drop places its replacement, so the cap and the paused-trading refusal moved
  // to that path with the placement they now guard (`useFuturesOrderDrag`).
  // Repricing by typing keeps the single-call amendment and its safety: the
  // amend panel is the surface where a rejection leaves the order where it was.

  // Sizing the ticket from an open position: the quantity comes from the dock,
  // the price from wherever the operator is working, so "the whole position"
  // means the whole position at the limit they are about to place.
  useEffect(() => {
    if (!sizeRequest || handledSizeRef.current === sizeRequest.id) return
    handledSizeRef.current = sizeRequest.id
    const priceNumber = Number(price)
    if (!Number.isFinite(priceNumber) || priceNumber <= 0) {
      setFeedback({
        tone: 'ignored',
        title: 'Size NOT applied',
        detail: 'Pick a price first — the position is sized at the price you trade at.',
      })
      return
    }
    // Floored to whole USDT, so a full-position exit can never round up past
    // the position it is closing.
    const notional = quantizeFuturesNotionalUsdt((sizeRequest.quantity * priceNumber).toFixed(2))
    if (notional === null) {
      setFeedback({
        tone: 'ignored',
        title: 'Size NOT applied',
        detail: 'The position size could not be valued at this price.',
      })
      return
    }
    setCustomNotionalUsdt(notional)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeRequest])

  // Feedback and sizing belong to one symbol's trading session; a symbol change
  // clears both, so a size chosen for the previous contract cannot be inherited
  // by the next one and fired by a gesture.
  useEffect(() => {
    if (feedbackSymbolRef.current === selectedSymbol) return
    feedbackSymbolRef.current = selectedSymbol
    setFeedback(null)
    setSizePercent(0)
    setCustomNotionalUsdt(null)
    // An order staged for the previous contract must never be confirmable
    // against the new one.
    setPendingOrder(null)
    setUnsentConfirmation(null)
  }, [selectedSymbol])

  // Recomputed on every render rather than frozen at staging time, so the
  // projected position keeps up with account updates that land while the
  // operator is still reading the panel.
  const pendingConfirmation = pendingOrder
    ? describeFuturesOrderConfirmation({
      action: pendingOrder.action,
      symbol: pendingOrder.symbol,
      price: pendingOrder.price,
      quantity: pendingOrder.quantity,
      notionalUsdt: pendingOrder.notionalUsdt,
      // Read live rather than from the staged draft: the panel states the terms
      // the position will actually be carried at, and a leverage change that
      // lands while the confirmation is open changes them.
      leverage: entryLeverage,
      marginMode: contractMarginMode,
      positions,
      priceReading: pendingOrder.priceReading,
    })
    : null

  const readinessBlockReason = !readiness.ready
    && readiness.code !== FUTURES_READINESS_CODES.ACCOUNT_LOADING
    ? readiness.reason
    : null
  // Zero is the ticket's ordinary starting size, not evidence that price or
  // exchange metadata failed. Keep the actions gated, but wait until the
  // operator starts sizing before presenting draft validation as a problem.
  // Readiness failures retain priority, so a real metadata or account outage is
  // never hidden by the quiet idle state.
  const untouchedZeroSize = customNotionalUsdt === null && sizePercent === 0
  const draftReason = readinessBlockReason ?? (untouchedZeroSize
    ? null
    : orderDraft.ok
      ? (!amountWithinBudget && sizingReady ? 'Order size exceeds the available balance' : null)
      : (price ? DRAFT_REASON_MESSAGES[orderDraft.reason] ?? null : 'Pick a chart or order-book price'))
  const selectedOpenOrders = openOrders.filter(order => order.symbol === selectedSymbol)
  // Adjusting state during render rather than in an effect: the rejection must
  // be on screen in the same commit it arrived in, not one paint later.
  if (safeState.lastError && safeState.lastError !== givenRejection) {
    setGivenRejection(safeState.lastError)
    setHeldRejection(safeState.lastError)
  }
  const lastError = heldRejection
  const unresolvedCommand = safeState.unresolvedCommand ?? null
  const accountFailures = Object.entries(safeState.accountResources ?? {})
    .filter(([, resource]) => resource?.status === 'error' || resource?.status === 'stale')
  // What the resting orders come to, summed from the same list the operator
  // reads them in and priced by the same helper as every row of it.
  //
  // Not the exchange's order margin: that is what the orders cost to hold, a
  // fraction of their value at leverage and nothing at all for reduce-only
  // exits, and it is not the number the operator is checking against their
  // orders. Until the orders have synchronized once there is no total to state,
  // on the same terms as the balance beside it — an empty list means nothing is
  // resting and reads as zero.
  const workingOrdersUsdt = ordersAvailability.known
    ? totalOrderNotionalUsdt(openOrders)
    : null

  // What Binance would refuse anyway, refused here instead — with the desk's own
  // words rather than a code the operator has to look up, and without spending a
  // signed request to be told what the desk already knows. `-4048` while the
  // contract carries a position, `-4047` while an order rests on it.
  const marginModeHeldBy = positions.some(position => (
    position?.symbol === selectedSymbol && Number(position?.quantity) !== 0
  ))
    ? {
      code: 'MARGIN_MODE_HELD_BY_POSITION',
      message: `${selectedSymbol} carries an open position — Binance refuses a margin-mode change while it is open. Nothing was sent.`,
    }
    : selectedOpenOrders.length > 0
      ? {
        code: 'MARGIN_MODE_HELD_BY_ORDER',
        message: `${selectedSymbol} has a working order — Binance refuses a margin-mode change while one rests. Nothing was sent.`,
      }
      : null
  const marginModeReason = marginModeHeldBy !== null
    ? marginModeHeldBy.message
    : contractMarginMode === null
      ? 'The margin mode of this contract has not been reported yet'
      : `${selectedSymbol} is carried in ${
        contractMarginMode === 'CROSSED' ? 'cross' : 'isolated'
      } margin — click to switch it to ${
        contractMarginMode === 'CROSSED' ? 'isolated' : 'cross'
      }`
  // One click, one contract, the other mode. The chip goes on showing what the
  // exchange last reported until a read says otherwise: what was asked for is
  // not what is held, and this is the field an operator would size against.
  const changeMarginMode = () => {
    if (marginModeHeldBy !== null) {
      setHeldRejection(marginModeHeldBy)
      return
    }
    if (contractMarginMode === null) return
    const requested = contractMarginMode === 'CROSSED' ? 'ISOLATED' : 'CROSSED'
    if (onMarginModeChange?.({ symbol: selectedSymbol, marginType: requested }) === false) {
      setHeldRejection({
        code: 'LOCAL_CONNECTION_UNAVAILABLE',
        message: 'Local backend connection unavailable — the margin mode was not changed.',
      })
    }
  }

  return (
    <aside className="futures-production-execution-ticket" aria-label="Futures trading ticket">
      {feedback ? (
        <div
          className={`futures-production-feedback is-${feedback.tone}`}
          role="status"
          aria-label="Futures gesture feedback"
        >
          <div>
            <strong>{feedback.title}</strong>
            <span>{feedback.detail}</span>
          </div>
          <button type="button" aria-label="Dismiss feedback" onClick={() => setFeedback(null)}>
            ×
          </button>
        </div>
      ) : null}

      <div className="futures-production-tabs" role="tablist" aria-label="Futures trading rail tabs">
        <button type="button" role="tab" aria-selected={tab === 'trade'} onClick={() => setTab('trade')}>Trade</button>
        <button type="button" role="tab" aria-selected={tab === 'orders'} onClick={() => setTab('orders')}>
          Orders <span>{ordersAvailability.known ? openOrders.length : '—'}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'positions'} onClick={() => setTab('positions')}>
          Positions <span>{positionsAvailability.known ? positions.length : '—'}</span>
        </button>
      </div>

      <div className="futures-production-execution-body">
        {tab === 'trade' ? (
          <section className="futures-production-action is-order" aria-label="Futures order size">
            <div className="futures-production-ticket-symbol">
              <strong>{selectedSymbol}</strong>
              {/* The two together are the terms of every entry on this
                  contract, so they are kept together: a rail narrow enough to
                  wrap a long symbol used to put the mode on a line of its own,
                  which cost the ticket a whole row and separated the multiple
                  from what stands behind it. */}
              <div className="futures-production-ticket-terms">
                {/* The multiple every entry on this contract is taken at, stated
                    where the size is chosen rather than nowhere — and it is the
                    control that changes it. */}
                {typeof onLeverageEdit === 'function' ? (
                  <button
                    type="button"
                    className="futures-production-ticket-leverage"
                    aria-label={`Set ${selectedSymbol} leverage`}
                    title={entryLeverage === null
                      ? 'Leverage not reported yet — click to set it'
                      : `${entryLeverage}× leverage on ${selectedSymbol} — click to change it`}
                    onClick={event => onLeverageEdit(selectedSymbol, {
                      x: event.clientX,
                      y: event.clientY,
                    })}
                  >
                    {entryLeverage === null ? 'Lev' : `${entryLeverage}×`}
                  </button>
                ) : null}
                {/* And what stands behind it: isolated caps a losing position
                    at its own margin, cross stands the wallet behind it. The
                    exchange announces this field on no stream, so what is shown
                    here is what the desk last read — and acting on it is the
                    only way the mode changes from this desk. */}
                {typeof onMarginModeChange === 'function' ? (
                  <button
                    type="button"
                    className={`futures-production-ticket-margin-mode is-${
                      marginModeHeldBy !== null
                        ? 'held'
                        : contractMarginMode === null ? 'unknown' : contractMarginMode.toLowerCase()
                    }`}
                    aria-label={`Set ${selectedSymbol} margin mode`}
                    title={marginModeReason}
                    onClick={changeMarginMode}
                  >
                    {contractMarginMode === null
                      ? 'Mode'
                      : contractMarginMode === 'CROSSED' ? 'CROSS' : 'ISO'}
                  </button>
                ) : null}
              </div>
            </div>
            <label className="futures-production-price-field">
              <span>Selected price</span>
              <input
                aria-label="Exact limit price"
                type="text"
                inputMode="decimal"
                placeholder="Click chart or order book"
                value={price}
                onChange={event => updatePrice(event.target.value)}
              />
              {/* Only for a price taken off a surface that was not live. A typed
                  price is the operator's own number and carries no reading. */}
              <FuturesReadingNotice
                reading={draftPriceReading}
                className="futures-production-price-age"
              />
            </label>
            <label className="futures-production-size-slider">
              <span>Size</span>
              <input
                aria-label="Order size percent"
                type="range"
                min="0"
                max="100"
                step="0.5"
                value={displayedSizePercent}
                disabled={!sizingControlsReady}
                style={{ '--futures-size-fill': `${displayedSizePercent}%` }}
                onChange={(event) => {
                  setCustomNotionalUsdt(null)
                  setSizePercent(Number(event.target.value))
                }}
              />
            </label>
            <label className="futures-production-notional-field">
              <span className="futures-production-notional-label">
                <span>Notional, USDT</span>
                <output aria-live="polite" aria-label={`Size ${displayedSizePercent}`}>
                  <strong>{`${displayedSizePercent}%`}</strong>
                </output>
              </span>
              <input
                className="futures-production-notional-input"
                aria-label="Order notional USDT"
                type="text"
                inputMode="decimal"
                placeholder="—"
                disabled={!sizingControlsReady}
                value={notionalUsdt}
                onChange={event => setCustomNotionalUsdt(event.target.value)}
              />
            </label>
            <dl className="futures-production-order-summary">
              <div><dt>Price</dt><dd>{orderDraft.ok ? orderDraft.price : exactText(price)}</dd></div>
              {/* Six and seven figures: the cents never change a decision and
                  cost a glance on every read, so funds are stated whole. */}
              <div>
                <dt>Available</dt>
                <dd title={availableUsdt ?? undefined}>
                  {availableUsdt ? `${formatUsdtAmount(availableUsdt, 0)} USDT` : '—'}
                  {/* Only while it is unconfirmed. A line that is always on
                      screen is a line nobody reads on the one occasion it
                      matters. */}
                  {balanceUnconfirmed
                    ? <FuturesBalanceAge at={balanceResource.lastSuccessfulAt} />
                    : null}
                </dd>
              </div>
              {/* What the entry actually costs out of the wallet: the notional is
                  the position, this is the money held against it. Without the
                  leverage the two are the same number, which is exactly the
                  confusion that made an operator ask what they were trading at. */}
              <div>
                <dt title={entryLeverage === null
                  ? 'Margin held against this order. Leverage unknown, so this is the full notional.'
                  : `Notional ÷ ${entryLeverage}× leverage`}
                >
                  Est. margin
                </dt>
                <dd>
                  {orderDraft.ok
                    ? `${formatUsdtAmount(orderDraft.estimatedMarginUsdt)} USDT`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>On order</dt>
                <dd title={workingOrdersUsdt === null
                  ? undefined
                  : `${formatUsdtAmount(workingOrdersUsdt)} USDT across ${openOrders.length} working order${openOrders.length === 1 ? '' : 's'}`}
                >
                  {workingOrdersUsdt === null
                    ? '—'
                    : `${formatUsdtAmount(workingOrdersUsdt, 0)} USDT`}
                </dd>
              </div>
            </dl>
            {!feedback && draftReason ? (
              <p className="futures-production-draft-reason" role="status">{draftReason}</p>
            ) : null}
            <div className="futures-production-manual-actions" aria-label="Manual Futures orders">
              {ORDER_ACTIONS.map(action => (
                <button
                  type="button"
                  key={action.key}
                  className={`is-${action.positionSide.toLowerCase()} is-${action.positionEffect.toLowerCase()}`}
                  disabled={!canSubmitAction(action)}
                  onClick={() => submitLimitOrder(action, orderDraft)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </section>
        ) : tab === 'orders' ? (
          <section className="futures-production-orders" role="tabpanel" aria-label="Current Futures orders">
            <header className="futures-production-portfolio-heading">
              <div>
                <strong>Open orders</strong>
                <span>
                  {ordersAvailability.known
                    ? `${openOrders.length} account-wide · ${selectedOpenOrders.length} ${selectedSymbol}`
                    : `— account-wide · — ${selectedSymbol}`}
                </span>
              </div>
              <button
                type="button"
                aria-label="Refresh positions and orders"
                title="Refresh positions and orders"
                disabled={typeof safeState.refresh !== 'function'}
                onClick={() => safeState.refresh?.(selectedSymbol)}
              >
                ↻
              </button>
            </header>
            <FuturesResourceAvailabilityNotice
              availability={ordersAvailability}
              label="Open orders synchronization"
            />
            {openOrders.length === 0
              ? (ordersAvailability.known ? <p>No active Futures orders.</p> : null)
              : (
                <div className="futures-production-order-rows" role="table" aria-label="Working orders">
                  {/* The columns are named once at the head instead of every row
                      carrying its own unit: six rows of `10983 USDT` in a rail
                      this narrow is six repetitions of one word, and the word is
                      what pushed the value into the cancel control. */}
                  <div className="futures-production-order-head" role="row">
                    <span role="columnheader">Symbol</span>
                    <span role="columnheader">Side</span>
                    <span role="columnheader">Price</span>
                    <span role="columnheader" title="What the order is worth, in USDT">USDT</span>
                    <span role="columnheader" />
                  </div>
                  {openOrders.map((order) => {
                    const intent = describeFuturesOrderIntent(order)
                    const isAlgo = order.orderKind === 'ALGO'
                    const trigger = describeFuturesAlgoTrigger(order)
                    // The editor submits to Binance's amend endpoint, which
                    // re-states LIMIT orders only — the same promise rule the
                    // chart's grip follows. A doorway on a stop read "Edit …
                    // order at 0" and the refusal arrived after the form was
                    // filled in.
                    const editable = futuresOrderPriceIsMovable(order) && typeof onOrderEdit === 'function'
                    const displayedPrice = formatPriceOrAbsent(
                      trigger.spawnedPrice ?? orderPresentationPrice(order),
                      tickOf(order.symbol),
                    )
                    const displayedTrigger = formatPriceOrAbsent(
                      order.triggerPrice ?? order.price,
                      tickOf(order.symbol),
                    )
                    const priceTitle = trigger.triggered
                      ? `${displayedPrice} · fired from a trigger at ${displayedTrigger}`
                      : displayedTrigger !== '—' && displayedTrigger !== displayedPrice
                        ? `${displayedPrice} · activates at ${displayedTrigger}`
                        : displayedPrice === '—' ? undefined : displayedPrice
                    return (
                      <div
                        className={`futures-production-order-row is-${intent.tone}${order.symbol === selectedSymbol ? ' is-current-symbol' : ''}${editable ? ' is-editable' : ''}${trigger.triggered ? ' is-triggered' : ''}`}
                        role="row"
                        key={`${order.orderKind ?? 'REGULAR'}:${order.symbol}:${order.orderId}`}
                        tabIndex={editable ? 0 : undefined}
                        aria-label={editable
                          ? `Edit ${order.symbol} ${intent.side} order at ${order.price}`
                          : undefined}
                        onKeyDown={editable
                          ? event => openOrderEditorFromKeyboard(event, order, onOrderEdit)
                          : undefined}
                        onDoubleClick={editable
                          ? event => onOrderEdit(order, {
                            x: event.clientX,
                            y: event.clientY,
                          })
                          : undefined}
                      >
                        <span role="cell">
                          <button
                            type="button"
                            className="futures-production-order-symbol"
                            aria-label={`Show ${order.symbol}`}
                            title={order.symbol}
                            onClick={(event) => {
                              event.stopPropagation()
                              onSymbolChange?.(order.symbol)
                            }}
                            onDoubleClick={event => event.stopPropagation()}
                          >
                            {contractLabel(order.symbol)}
                          </button>
                        </span>
                        {/* The leg, and what the order does to it — on the
                            element rather than beside it. The dock and the chart
                            both carry the word `exit`; this rail cannot. Measured
                            in Chromium: at a 281px rail the side cell has 69px
                            and `SHORT` with the badge needs 83, and because the
                            badge trails the leg it is the badge that gets cut —
                            the new reading eaten by the old one. Worse, the track
                            is sized from its own content, so a row carrying a
                            badge pushed its price and value out of line with the
                            rows above it. */}
                        <span
                          role="cell"
                          title={intent.positionEffect === 'EXIT' ? exitTitle(intent) : undefined}
                        >
                          <span className={`futures-production-side is-${intent.tone}`}>
                            {intent.label}
                          </span>
                        </span>
                        {/* An order rests at its positive limit where it has one,
                            falling back to its trigger for a market stop, at the
                            contract's tick rather than at the stream's padded
                            width — `8.1200000` is nine characters of which three
                            carry information, and in this column it wrapped onto a
                            second line. An order carrying neither price reads as
                            absent rather than as resting at zero. */}
                        <span
                          role="cell"
                          title={priceTitle}
                        >
                          {/* A parent that fired is priced where it fired, not
                              where it was waiting to. */}
                          <code>{displayedPrice}</code>
                        </span>
                        <span role="cell" title={orderSizeTitle(order)}>
                          <b>{orderNotionalUsdt(order) ?? '—'}</b>
                        </span>
                        <span role="cell">
                          {isAlgo ? (
                            <em title={trigger.triggered
                              ? `Fired into order ${trigger.spawnedOrderId}; awaiting confirmation. It is no longer working, so it cannot be moved or cancelled.`
                              : 'Managed on Binance'}
                            >
                              {trigger.triggered ? 'FIRED' : 'ALGO'}
                            </em>
                          ) : (
                            <button
                              type="button"
                              className="futures-production-order-cancel"
                              aria-label={`Cancel ${order.symbol} ${intent.side} order at ${order.price}`}
                              title="Cancel order"
                              onClick={() => safeState.cancelOrder?.({
                                symbol: order.symbol,
                                orderId: order.orderId,
                              })}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            {openOrders.length > 0 ? (
              <p className="futures-production-order-hint">
                Double-click a row or its chart line to change price and amount.
              </p>
            ) : null}
            {selectedOpenOrders.length > 0 ? (
              <button
                type="button"
                className="futures-production-cancel-all"
                onClick={() => safeState.cancelAll?.(selectedSymbol)}
              >
                Cancel all {selectedSymbol}
              </button>
            ) : null}
          </section>
        ) : (
          <section className="futures-production-positions" role="tabpanel" aria-label="Open positions">
            <header className="futures-production-portfolio-heading">
              <div>
                <strong>Positions</strong>
                <span>{positionsAvailability.known ? `${positions.length} open` : '— open'}</span>
              </div>
              <button
                type="button"
                aria-label="Refresh positions and orders"
                title="Refresh positions and orders"
                disabled={typeof safeState.refresh !== 'function'}
                onClick={() => safeState.refresh?.(selectedSymbol)}
              >
                ↻
              </button>
            </header>
            <FuturesResourceAvailabilityNotice
              availability={positionsAvailability}
              label="Positions synchronization"
            />
            {positions.length === 0
              ? (positionsAvailability.known ? <p>No open positions.</p> : null)
              : positions.map(position => (
                <FuturesTradingPositionCard
                  key={`${position.symbol}:${position.positionSide}`}
                  position={position}
                  store={safeState.positionMarkStore}
                  snapshotAt={positionSnapshotAt}
                  snapshotCoherent={positionSnapshotCoherent}
                  snapshotConfirmed={positionSnapshotConfirmed}
                  tickSize={tickOf(position.symbol)}
                  onPositionClose={onPositionClose}
                />
              ))}
          </section>
        )}

        {/* An unconfirmed submission outranks every other status: the order may
            be live, and nothing else on this card is more urgent to read. It
            carries no control at all — a retry here is what creates the second
            order. */}
        {unresolvedCommand ? (
          <section
            className="futures-production-backend-card is-unresolved"
            role="alert"
            aria-label="Futures command outcome unconfirmed"
          >
            <strong>{unresolvedCommand.code}</strong>
            <code>{unresolvedCommand.message}</code>
          </section>
        ) : null}
        {/* The operator's own last command and a background synchronization
            failure are different facts, and the second used to hide the first:
            a rejection of the order just sent was displaced by a balance that
            happened to be refreshing badly. Both are shown, the command first,
            and the exchange's own code with it. */}
        {lastError ? (
          <section className="futures-production-backend-card is-rejected" aria-label="Futures command rejection">
            <strong>
              {lastError.code}
              {/* The failed condition of a desk-side refusal, where the
                  exchange's code would sit — one code stood for five causes
                  until 2026-08-24. */}
              {lastError.details?.cause == null
                ? ''
                : ` · ${lastError.details.cause}`}
              {lastError.details?.binanceCode == null
                ? ''
                : ` · Binance ${lastError.details.binanceCode}`}
            </strong>
            <code>{lastError.message}</code>
            {/* The refusal stays until it is read. Dismissing it is the operator
                saying so — nothing else on the desk may decide that for them. */}
            <button
              type="button"
              aria-label="Dismiss rejection"
              onClick={() => setHeldRejection(null)}
            >
              Dismiss
            </button>
          </section>
        ) : null}
        {accountFailures.length > 0 ? (
          <section className="futures-production-backend-card is-rejected" aria-label="Futures account synchronization errors">
            {accountFailures.map(([resourceName, resource]) => (
              <div key={`${resourceName}:${resource.error?.code ?? resource.status}`}>
                <strong>{resourceName} · {resource.status}</strong>
                <code>{resource.error?.message ?? 'Synchronization failed.'}</code>
              </div>
            ))}
            <button type="button" onClick={() => safeState.refresh?.(selectedSymbol)}>
              Retry account sync
            </button>
          </section>
        ) : null}
      </div>
      {pendingConfirmation ? (
        <FuturesOrderConfirmation
          confirmation={pendingConfirmation}
          anchor={pendingOrder.anchor}
          sizePercent={pendingSizingPercent}
          sizeBasis={pendingOrder.action.positionEffect === 'EXIT' ? 'of position' : 'of available'}
          sizeDisabled={pendingSizingMaximumUsdt === null}
          sizeReason={pendingSizingReason}
          confirmDisabled={pendingOrder.resizedInConfirmation === true
            && (pendingSizingReason !== null || !pendingOrder.draft.ok)}
          unsent={unsentConfirmation}
          onSizePercentChange={resizePendingOrder}
          onConfirm={confirmPendingOrder}
          onCancel={cancelPendingOrder}
        />
      ) : null}
    </aside>
  )
}

export default memo(FuturesTradingTicket)
