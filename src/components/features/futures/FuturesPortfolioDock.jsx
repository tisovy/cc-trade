import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  describeFuturesAlgoTrigger,
  describeFuturesOrderIntent,
  describeFuturesPosition,
  describeFuturesPositionMargin,
  exitTitle,
  formatSignedPercent,
  formatSignedUsdt,
  formatUsdt,
  futuresPnlReadingNote,
  orderFilledNotionalUsdt,
  orderNotionalUsdt,
  orderPresentationPrice,
  orderWorkingQuantity,
} from '../../../utils/futuresOrderPresentation.js'
import { futuresOrderPriceIsMovable } from '../../../utils/futuresOrderDrag.js'
import { formatExchangePrice } from '../../../utils/futuresPriceFormat.js'
import { futuresMarginCallKey } from '../../../utils/futuresMarginCall.js'
import { applyFuturesPositionValuation } from '../../../utils/futuresPositionMarks.js'
import {
  useFuturesPositionValuation,
  useFuturesPositionValuationAggregate,
} from '../../../hooks/useFuturesPositionValuation.js'
import {
  describeFuturesOrderAvailability,
  describeFuturesResourceAvailability,
} from '../../../utils/futuresReadiness.js'
import { exactFuturesDeskTime, formatFuturesDeskTime } from '../../../utils/futuresDeskTime.js'
import { futuresTradePositionKey } from '../../../utils/futuresTradeRounds.js'
import { futuresSharedAdjustmentKey } from '../../../utils/futuresWalletPresentation.js'
import FuturesHistoryPanel from './FuturesHistoryPanel.jsx'

const EMPTY_ROWS = Object.freeze([])
const EMPTY_TICKS = Object.freeze({})
const EMPTY_MARGIN_CALLS = Object.freeze({})

// The dock's height is the operator's to set: a session reviewing forty orders
// wants rows, a session watching the chart wants the chart. The chosen height
// survives a restart the way the RSI pane's does, and a desk with no storage
// still resizes for the session.
export const FUTURES_DOCK_PANEL_HEIGHT_KEY = 'futuresDockPanelHeight'
const DOCK_PANEL_DEFAULT_HEIGHT = 260
const DOCK_PANEL_MIN_HEIGHT = 120

const dockPanelHeightCeiling = () => Math.max(
  DOCK_PANEL_MIN_HEIGHT,
  Math.round((window.innerHeight || 900) * 0.7),
)

const clampDockPanelHeight = value => Math.min(
  dockPanelHeightCeiling(),
  Math.max(DOCK_PANEL_MIN_HEIGHT, Math.round(value)),
)

const readStoredDockPanelHeight = () => {
  try {
    const stored = Number(window.localStorage?.getItem(FUTURES_DOCK_PANEL_HEIGHT_KEY))
    return Number.isFinite(stored) && stored > 0 ? clampDockPanelHeight(stored) : null
  } catch {
    return null
  }
}

// Which endpoint each tab is read out of. `working` is not a review at all — it
// is the live order list, and it reads nothing.
const HISTORY_VIEW_OF_TAB = Object.freeze({
  working: null,
  orderHistory: 'orders',
  tradeHistory: 'trades',
})

const EXACT_SETTLED_DECIMAL = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))$/

const exactSettledAmountParts = (value) => {
  const source = typeof value === 'string'
    ? value.trim()
    : Number.isFinite(value) ? String(value) : ''
  const match = EXACT_SETTLED_DECIMAL.exec(source)
  if (match === null) return null
  const whole = (match[2] ?? '0').replace(/^0+(?=\d)/, '') || '0'
  const fraction = match[3] ?? match[4] ?? ''
  const zero = /^0+$/.test(whole) && (fraction === '' || /^0+$/.test(fraction))
  return {
    sign: zero ? 0 : match[1] === '-' ? -1 : 1,
    whole,
    fraction: fraction.padEnd(2, '0'),
  }
}

const formatExactSettledAmount = (value) => {
  const parts = exactSettledAmountParts(value)
  if (parts === null) return null
  const prefix = parts.sign < 0 ? '−' : parts.sign > 0 ? '+' : ''
  return `${prefix}${parts.whole}.${parts.fraction}`
}

const formatSettledAmountForCell = (value) => {
  const parts = exactSettledAmountParts(value)
  if (parts === null) return null
  if (parts.fraction.length <= 2) return formatExactSettledAmount(value)
  const scaled = BigInt(`${parts.whole}${parts.fraction.slice(0, 2)}`)
    + (parts.fraction.charCodeAt(2) >= 53 ? 1n : 0n)
  // A non-zero amount rendered as 0.00 is not a compact reading; it is a false
  // zero. Keep the short sub-cent exact text, matching Closed Positions.
  if (scaled === 0n && parts.sign !== 0) return formatExactSettledAmount(value)
  const digits = scaled.toString().padStart(3, '0')
  const prefix = parts.sign < 0 ? '−' : parts.sign > 0 ? '+' : ''
  return `${prefix}${digits.slice(0, -2)}.${digits.slice(-2)}`
}

// The settled figure's own tone. Absent is not flat: a reading that has not
// arrived and a position that has settled exactly nothing are different states,
// and the tone is the only thing distinguishing them at a glance.
const settledToneOf = (settled) => {
  if (settled === null) return 'absent'
  if (settled.total === null) {
    const totals = (Array.isArray(settled.otherAssets) ? settled.otherAssets : [])
      .map(reading => exactSettledAmountParts(reading?.total)?.sign ?? null)
      .filter(sign => sign !== null)
    if (totals.length === 0) return 'absent'
    if (totals.every(total => total >= 0) && totals.some(total => total > 0)) return 'positive'
    if (totals.every(total => total <= 0) && totals.some(total => total < 0)) return 'negative'
    return 'flat'
  }
  const sign = exactSettledAmountParts(settled.total)?.sign ?? 0
  if (sign > 0) return 'positive'
  return sign < 0 ? 'negative' : 'flat'
}

const SETTLED_COMPONENT_LABELS = Object.freeze({
  realizedPnl: 'realized',
  funding: 'funding',
  commission: 'commission',
  insuranceClear: 'insurance',
})

// Every component the exchange charged or credited, named. A single net figure
// the operator cannot decompose cannot be checked against Binance, and checking
// it against Binance is what this column is for.
const settledBreakdown = totals => Object.entries(SETTLED_COMPONENT_LABELS)
  .filter(([name]) => totals?.[name] !== null && totals?.[name] !== undefined)
  .flatMap(([name, label]) => {
    const amount = formatExactSettledAmount(totals[name])
    return amount === null ? [] : [`${amount} ${label}`]
  })

const signedAssetAmount = (reading, { compact = false } = {}) => {
  const asset = String(reading?.asset ?? '').trim().toUpperCase()
  const signed = compact
    ? formatSettledAmountForCell(reading?.amount)
    : formatExactSettledAmount(reading?.amount)
  if (asset === '' || signed === null) return null
  return `${signed} ${asset}`
}

const OPEN_SETTLED_QUALIFICATION_LABELS = Object.freeze({
  TRADE_COVERAGE_INCOMPLETE: 'Trade history is incomplete',
  COMMISSION_COVERAGE_INCOMPLETE: 'Commission history is incomplete',
  FUNDING_COVERAGE_INCOMPLETE: 'Funding history is incomplete',
  INSURANCE_COVERAGE_INCOMPLETE: 'Insurance history is incomplete',
  COMMISSION_CREDIT_COVERAGE_INCOMPLETE: 'Commission-credit history is incomplete',
  MULTI_ASSET: 'Amounts settle in multiple assets',
  OWNERSHIP_NOT_ADDITIVE: 'Exact ownership is not established',
  IDENTITY_UNRELIABLE: 'An income identity is not reliable',
  IDENTITY_CONFLICT: 'Conflicting payloads reuse one income identity',
})

const OPEN_SHARED_COMPONENT_LABELS = Object.freeze({
  funding: 'funding',
  insurance: 'insurance',
  commissionCredit: 'commission credit',
})

const openSharedComponents = adjustment => (
  Array.isArray(adjustment?.components)
    ? adjustment.components.map(component => (
      OPEN_SHARED_COMPONENT_LABELS[component] ?? String(component)
    ))
    : EMPTY_ROWS
)

const openSharedQualifications = adjustment => (
  Array.isArray(adjustment?.qualifications)
    ? adjustment.qualifications.map(code => (
      OPEN_SETTLED_QUALIFICATION_LABELS[code]
        ?? String(code).toLowerCase().replaceAll('_', ' ')
    ))
    : EMPTY_ROWS
)

const settledVisibleAmounts = (settled) => {
  if (settled === null || typeof settled !== 'object') return EMPTY_ROWS
  const amounts = []
  const settlementAsset = String(settled.settlementAsset ?? '').trim().toUpperCase()
  const total = formatSettledAmountForCell(settled.total)
  if (total !== null) {
    amounts.push({
      key: `settlement:${settlementAsset || 'unknown'}`,
      text: `${total}${settlementAsset === '' ? '' : ` ${settlementAsset}`}`,
    })
  }
  for (const reading of Array.isArray(settled.otherAssets) ? settled.otherAssets : []) {
    const text = signedAssetAmount(reading, { compact: true })
    if (text === null) continue
    const asset = String(reading?.asset ?? '').trim().toUpperCase()
    amounts.push({ key: `other:${asset}`, text })
  }
  return amounts
}

// Three different absences wear the same `—`, and until 2026-08-20 they wore the
// same sentence too: a read that never arrived, a read that arrived and named
// other contracts, and a contract the read reached with nothing charged against
// it. The operator reported an empty column and the desk could not say which of
// the three it was, so the whole path had to be read by hand. They are named
// apart here for the same reason the journal now counts the read: an absence
// that explains itself is a fault with a trail.
const settledTitle = (settled, window, read, position) => {
  if (settled === null) {
    if (read === null) {
      return 'What this position has already settled — not read yet'
    }
    const symbol = String(position?.symbol ?? '').trim().toUpperCase()
    if (symbol !== '' && read.symbols.includes(symbol)) {
      const leg = String(position?.positionSide ?? '').trim().toUpperCase()
      return 'What this position has already settled — the income read reached this contract, '
        + `but no amount was assigned to${leg === '' || leg === 'BOTH' ? ' this position leg' : ` the ${leg} leg`}`
        + `${window?.readAt ? `, read ${exactFuturesDeskTime(window.readAt)}` : ''}`
    }
    return 'What this position has already settled — the income read answered '
      + `${read.contracts === 0 ? 'no contracts' : `${read.contracts} other contract${read.contracts === 1 ? '' : 's'}`}`
      + ` and nothing against this one${window?.readAt ? `, read ${exactFuturesDeskTime(window.readAt)}` : ''}`
  }
  // Two absences that print the same dash. A position that has settled nothing
  // is an answer; a contract the desk cannot tell this position's money from the
  // rest of the account's is a refusal to guess, and until 2026-08-20 it was not
  // a refusal at all — the column stated the contract's whole week against a
  // position opened that morning.
  if (settled.from === null) {
    return 'What this position has already settled — unknown: the fills read does not '
      + 'reach back to when this position was opened, so the desk cannot tell which of '
      + 'this contract’s realized PnL, funding and commission is this position’s'
  }
  if (settled.total === null && settled.otherAssets.length === 0) {
    return 'Nothing settled on this position yet — no realized PnL, funding or commission against it'
  }
  const parts = []
  if (settled.total !== null) {
    const total = formatExactSettledAmount(settled.total)
    if (total !== null) parts.push(`${total} ${settled.settlementAsset} settled`)
    const breakdown = settledBreakdown(settled)
    if (breakdown.length > 0) parts.push(breakdown.join(' · '))
  }
  // Charged in something the desk holds no rate for. Stated in its own asset
  // rather than converted into the total by a guess.
  for (const other of settled.otherAssets) {
    parts.push(`${signedAssetAmount(other) ?? `${other.total} ${other.asset}`} settled; ${
      settledBreakdown(other).join(' · ')} not converted`)
  }
  // What the figure covers. A total silently missing eight hours of funding is
  // worse than one that names its own edge.
  if (!settled.complete) {
    parts.push(window?.from
      ? `covers the read from ${exactFuturesDeskTime(window.from)}, not the whole life of the position`
      : 'covers the read’s window, not the whole life of the position')
  }
  return parts.join(' · ')
}

const exactText = value => (
  typeof value === 'string' && value.length > 0 ? value : (value ?? '—')
)

// Short enough for a table cell, and never guessed: a read that established no
// mode says nothing rather than defaulting to one of the two.
const marginModeLabel = mode => (
  mode === 'ISOLATED' ? 'ISO' : mode === 'CROSS' ? 'CROSS' : ''
)

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

// Positions and working orders live under the chart because they are what a
// trader watches continuously — a tab you have to open is a tab you forget.
// What a list of no rows means: nothing open, or nothing read yet. The dock used
// to say "0 open" and "No open positions." before the first account read had
// even answered, which is the one reading an operator must never be given
// falsely — a flat account and an unknown account call for opposite actions.
//
// No resource at all is the same unknown: a dock wired to a workstation with no
// execution state behind it knows nothing about the account, and the honest
// reading of nothing is "not read", not "nothing there".
const EMPTY_RESOURCES = Object.freeze({})

const positionSnapshotMeta = (resource, positionsKnown, hasHeldRows) => {
  const updatedAt = Number.isSafeInteger(resource?.updatedAt) ? resource.updatedAt : null
  const lastSuccessfulAt = Number.isSafeInteger(resource?.lastSuccessfulAt)
    ? resource.lastSuccessfulAt
    : null
  return Object.freeze({
    at: updatedAt ?? lastSuccessfulAt,
    confirmed: positionsKnown || hasHeldRows || lastSuccessfulAt !== null,
    // A private ACCOUNT_UPDATE may replace quantity/entry/uPnL while retaining
    // the older REST mark. Only equal read stamps prove the full snapshot fields
    // belong to one generation; otherwise fallback is the exchange uPnL scalar.
    coherent: (resource === null || resource === undefined) && hasHeldRows
      ? true
      : updatedAt !== null && updatedAt === lastSuccessfulAt,
  })
}

const valuationSourceNote = (valuation) => {
  if (valuation?.source === 'live-mark') {
    return ` · live exchange mark${valuation.sourceAt === null
      ? ''
      : ` at ${exactFuturesDeskTime(valuation.sourceAt)}`}`
  }
  if (valuation?.source === 'account-snapshot') {
    return ` · account snapshot fallback${valuation.sourceAt === null
      ? ''
      : ` from ${exactFuturesDeskTime(valuation.sourceAt)}`}; live mark unavailable`
  }
  return ' · unavailable: neither a live mark nor a confirmed account uPnL can value this position'
}

const FuturesPortfolioUnrealizedTotal = memo(({
  positions,
  positionsKnown,
  snapshot,
  store,
}) => {
  const aggregate = useFuturesPositionValuationAggregate({
    positions,
    positionsKnown,
    snapshotAt: snapshot.at,
    snapshotCoherent: snapshot.coherent,
    store,
  })
  const tone = aggregate.complete && aggregate.value > 0
    ? 'positive'
    : aggregate.complete && aggregate.value < 0 ? 'negative' : 'flat'
  const qualification = aggregate.missingCount === null
    ? 'positions not read'
    : aggregate.missingCount > 0
      ? `${aggregate.missingCount} position${aggregate.missingCount === 1 ? '' : 's'} missing`
      : aggregate.fallbackCount > 0
        ? `${aggregate.fallbackCount} account snapshot fallback${aggregate.fallbackCount === 1 ? '' : 's'}`
        : null
  const title = aggregate.missingCount === null
    ? 'Total uPnL is unknown until the positions resource has been read.'
    : aggregate.missingCount > 0
      ? `Incomplete total: ${aggregate.missingCount} open position${aggregate.missingCount === 1 ? '' : 's'} cannot be valued. The known rows sum to ${formatSignedUsdt(aggregate.value)} USDT.`
      : aggregate.fallbackCount > 0
        ? `Complete total using ${aggregate.fallbackCount} qualified account snapshot fallback${aggregate.fallbackCount === 1 ? '' : 's'} while live marks are unavailable.`
        : 'Complete total from the exchange mark used by every open-position row.'
  return (
    <div
      className={`futures-workstation-dock-total is-${tone}${aggregate.complete ? '' : ' is-incomplete'}`}
      title={title}
      data-testid="futures-upnl-total"
      data-complete={aggregate.complete ? 'true' : 'false'}
    >
      <span>Total uPnL</span>
      <strong>{aggregate.complete ? `${formatSignedUsdt(aggregate.value)} USDT` : '— USDT'}</strong>
      {qualification === null ? null : <em>{qualification}</em>}
    </div>
  )
})

const FuturesPortfolioPositionRow = memo(({
  marginCall,
  onClosePosition,
  onLeverageEdit,
  onMarginEdit,
  onSizePick,
  onSymbolChange,
  position,
  selected,
  settled,
  settledRead,
  settledWindow,
  snapshot,
  store,
  tickSize,
}) => {
  const valuation = useFuturesPositionValuation(position, store, {
    snapshotAt: snapshot.at,
    snapshotConfirmed: snapshot.confirmed,
    snapshotCoherent: snapshot.coherent,
  })
  const valuedPosition = useMemo(
    () => applyFuturesPositionValuation(position, valuation),
    [position, valuation],
  )
  const presentation = describeFuturesPosition(valuedPosition)
  const margin = describeFuturesPositionMargin(valuedPosition)
  const priceOf = value => formatExchangePrice(value, tickSize)
  const hasPnl = valuation.unrealizedPnl !== null
  const hasRoe = valuation.roeComplete && valuation.roe !== null
  const settledAmounts = settledVisibleAmounts(settled)
  return (
    <div
      className={`futures-workstation-dock-row is-${presentation.tone}${selected ? ' is-current-symbol' : ''}`}
      role="row"
      data-position-key={`${position.symbol}:${position.positionSide}`}
      data-valuation-source={valuation.source}
    >
      <span role="cell" className="futures-workstation-dock-instrument">
        <button
          type="button"
          className="futures-workstation-dock-symbol"
          aria-label={`Show ${position.symbol}`}
          onClick={() => onSymbolChange?.(position.symbol)}
        >
          {position.symbol}
        </button>
        {typeof onLeverageEdit === 'function' ? (
          <button
            type="button"
            className="futures-workstation-dock-leverage"
            aria-label={`Set ${position.symbol} leverage`}
            title={position.leverage
              ? `${position.leverage}× leverage — click to change it`
              : 'Leverage not reported yet — click to set it'}
            onClick={event => onLeverageEdit(position.symbol, {
              x: event.clientX,
              y: event.clientY,
            })}
          >
            {position.leverage ? `${position.leverage}×` : 'Lev'}
          </button>
        ) : null}
      </span>
      <span role="cell" className={`futures-workstation-dock-side is-${presentation.tone}`}>
        {presentation.positionSide}
      </span>
      <span role="cell">
        {selected && presentation.absoluteQuantity !== null && typeof onSizePick === 'function' ? (
          <button
            type="button"
            className="futures-workstation-dock-size"
            aria-label={`Size the ticket for the whole ${position.symbol} ${presentation.positionSide} position`}
            title={`${exactText(position.quantity)} contracts — size the ticket for the whole position`}
            onClick={() => onSizePick(presentation.absoluteQuantity)}
          >
            {formatUsdt(valuation.notional)}
          </button>
        ) : (
          <span title={`${exactText(position.quantity)} contracts`}>
            {formatUsdt(valuation.notional)}
          </span>
        )}
      </span>
      <span role="cell">{priceOf(position.entryPrice)}</span>
      <span role="cell">{priceOf(valuation.markPrice)}</span>
      <span
        role="cell"
        className={`futures-workstation-dock-liquidation${marginCall === null ? '' : ' is-margin-call'}`}
        title={marginCall === null ? undefined : `Margin call from the exchange at ${
          exactFuturesDeskTime(marginCall.at)
        }${marginCall.maintenanceMargin === null ? '' : ` — maintenance margin required ${
          marginCall.maintenanceMargin}`}`}
      >
        {marginCall === null ? null : (
          <span aria-label={`${position.symbol} margin call`} role="img">⚠ </span>
        )}
        {priceOf(position.liquidationPrice)}
      </span>
      <span role="cell">
        {margin.margin !== null && typeof onMarginEdit === 'function' ? (
          <button
            type="button"
            className={`futures-workstation-dock-margin is-${margin.marginMode === 'CROSS' ? 'cross' : 'isolated'}`}
            aria-label={`Adjust margin on the ${position.symbol} ${presentation.positionSide} position`}
            title={margin.marginMode === 'CROSS'
              ? 'Cross margin — backed by the whole account'
              : 'Isolated margin — click to add or remove'}
            onClick={event => onMarginEdit(position, {
              x: event.clientX,
              y: event.clientY,
            })}
          >
            <em>{marginModeLabel(margin.marginMode)}</em>
            {formatUsdt(margin.margin)}
          </button>
        ) : (
          <span className="futures-workstation-dock-margin is-static">
            <em>{marginModeLabel(margin.marginMode)}</em>
            {margin.margin === null ? '—' : formatUsdt(margin.margin)}
          </span>
        )}
      </span>
      <span
        role="cell"
        className={`futures-workstation-dock-pnl is-${hasPnl ? presentation.pnlTone : 'absent'}`}
        title={`${hasPnl ? `${formatSignedUsdt(valuation.unrealizedPnl)} USDT${
          hasRoe ? ` · ${formatSignedPercent(valuation.roe)} on margin` : ' · ROE unavailable'
        }` : 'uPnL and ROE unavailable'}${valuationSourceNote(valuation)}${futuresPnlReadingNote(presentation, priceOf)}`}
      >
        <strong>{hasPnl ? formatSignedUsdt(valuation.unrealizedPnl) : '—'}</strong>
        <em>{hasRoe ? formatSignedPercent(valuation.roe) : '—'}</em>
      </span>
      <span
        role="cell"
        className={`futures-workstation-dock-settled is-${settledToneOf(settled)}${
          settled !== null && settled.complete === false ? ' is-partial' : ''}`}
        title={settledTitle(settled, settledWindow, settledRead, position)}
      >
        {/* The number and nothing else — the operator ruled every inline badge
            off this cell (2026-08-23). A partial reading keeps its dotted
            underline and states its reasons on the element; a failed resource
            already surfaces through the dock's own alert line. */}
        {settledAmounts.length === 0 ? '—' : (
          <span className="futures-workstation-dock-asset-amounts">
            {settledAmounts.map(amount => <strong key={amount.key}>{amount.text}</strong>)}
          </span>
        )}
      </span>
      <span role="cell">
        <button
          type="button"
          className="futures-workstation-dock-close"
          aria-label={`Close ${position.symbol} ${presentation.positionSide} position`}
          disabled={typeof onClosePosition !== 'function'}
          onClick={event => onClosePosition?.(position, {
            x: event.clientX,
            y: event.clientY,
          })}
        >
          Close
        </button>
      </span>
    </div>
  )
})

export const FuturesPortfolioDock = ({
  selectedSymbol,
  positions = EMPTY_ROWS,
  openOrders = EMPTY_ROWS,
  accountResources = EMPTY_RESOURCES,
  tickSizes = EMPTY_TICKS,
  marginCalls = EMPTY_MARGIN_CALLS,
  history = null,
  positionMarkStore = null,
  tradeRoundIndex = null,
  // What each open position leg has already settled, keyed by canonical
  // symbol-plus-leg identity, and the window it was read over. Both may be null:
  // an account read that has not answered is not an account that settled nothing.
  settledMoney = null,
  settledWindow = null,
  // The settled-income resource state explains the canonical closed-round
  // wallet index below, including a stale/failed refresh and its last proof.
  settledIncome = null,
  onClosePosition,
  onCancelOrder,
  onOrderEdit,
  onMarginEdit,
  onLeverageEdit,
  onSymbolChange,
  onSizePick,
  onLoadHistory,
  onRefreshAccount,
}) => {
  const [ordersTab, setOrdersTab] = useState('working')
  const [isCollapsed, setIsCollapsed] = useState(false)
  // null means "the CSS default": content-sized up to the stylesheet's cap. A
  // number is the operator's own height, applied to both panels through one
  // custom property so the pair never drifts apart.
  const [panelHeight, setPanelHeight] = useState(readStoredDockPanelHeight)
  const dockRef = useRef(null)
  const dockDragRef = useRef(null)
  const dockResetArmedAtRef = useRef(0)
  useEffect(() => {
    try {
      if (panelHeight === null) {
        window.localStorage?.removeItem(FUTURES_DOCK_PANEL_HEIGHT_KEY)
      } else {
        window.localStorage?.setItem(FUTURES_DOCK_PANEL_HEIGHT_KEY, String(panelHeight))
      }
    } catch {
      // Height still applies for the session; only its survival is lost.
    }
  }, [panelHeight])
  const measuredPanelHeight = () => {
    if (panelHeight !== null) return panelHeight
    const panel = dockRef.current?.querySelector('.futures-workstation-dock-panel')
    const measured = panel?.getBoundingClientRect().height
    return Number.isFinite(measured) && measured > 0
      ? measured
      : DOCK_PANEL_DEFAULT_HEIGHT
  }
  const beginDockResize = (event) => {
    dockDragRef.current = {
      pointerId: event.pointerId,
      y: event.clientY,
      height: measuredPanelHeight(),
      moved: false,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  const moveDockResize = (event) => {
    const drag = dockDragRef.current
    if (drag === null || drag.pointerId !== event.pointerId) return
    if (Math.abs(event.clientY - drag.y) >= 3) drag.moved = true
    // The handle sits on the dock's top edge: dragging up grows the dock.
    setPanelHeight(clampDockPanelHeight(drag.height + (drag.y - event.clientY)))
  }
  const endDockResize = (event) => {
    const drag = dockDragRef.current
    if (drag?.pointerId !== event.pointerId) return
    // Two quick drags land as a double-click. A reset the operator did not ask
    // for throws away the height they just set, so a press that moved keeps
    // the double-click reset disarmed for a beat.
    if (drag.moved) dockResetArmedAtRef.current = Date.now() + 500
    dockDragRef.current = null
  }
  const resetDockPanelHeight = () => {
    if (Date.now() < dockResetArmedAtRef.current) return
    setPanelHeight(null)
  }
  const keyboardDockResize = (event) => {
    const step = event.key === 'ArrowUp' ? 32 : event.key === 'ArrowDown' ? -32 : null
    if (step === null) return
    event.preventDefault()
    setPanelHeight(clampDockPanelHeight(measuredPanelHeight() + step))
  }
  const retryAccount = useCallback(() => {
    onRefreshAccount?.(selectedSymbol)
  }, [onRefreshAccount, selectedSymbol])
  // Whether an income read has answered at all, and what it named. A row with no
  // reading of its own is a different fault depending on this: null here means
  // nothing ever arrived, and a contract count means something did and this
  // contract was not in it.
  const settledRead = useMemo(() => {
    if (settledMoney === null) return null
    const symbols = new Set()
    for (const [positionKey, reading] of Object.entries(settledMoney)) {
      const symbol = String(reading?.symbol ?? positionKey.split(':', 1)[0] ?? '')
        .trim().toUpperCase()
      if (symbol !== '') symbols.add(symbol)
    }
    const orderedSymbols = Object.freeze([...symbols].sort())
    return Object.freeze({ contracts: orderedSymbols.length, symbols: orderedSymbols })
  }, [settledMoney])
  const priceOf = (symbol, value) => formatExchangePrice(value, tickSizes[symbol] ?? null)
  // A caller that passes the account state through may pass null for it.
  const resources = accountResources ?? EMPTY_RESOURCES
  const positionsAvailability = describeFuturesResourceAvailability([resources.positions])
  const valuationPositionsKnown = positionsAvailability.known || positions.length > 0
  const ordersAvailability = describeFuturesOrderAvailability(resources)
  const snapshot = useMemo(() => positionSnapshotMeta(
    resources.positions,
    positionsAvailability.known,
    positions.length > 0,
  ), [positions.length, positionsAvailability.known, resources.positions])
  // The reason and the way back, stated where the rows are read rather than only
  // on the trading rail. An operator looking at a list of orders is not looking
  // at the ticket, and "these are stale" is not a fact the ticket can carry for
  // a panel two columns away.
  const retry = typeof onRefreshAccount === 'function'
    ? (
      <button
        type="button"
        className="futures-workstation-dock-close"
        onClick={retryAccount}
      >
        Retry
      </button>
    )
    : null
  const openSharedAdjustments = Array.isArray(tradeRoundIndex?.openSharedAdjustments)
    ? tradeRoundIndex.openSharedAdjustments
    : EMPTY_ROWS
  const syncState = (availability, label) => {
    if (availability.notice === null && availability.label === null) return null
    const failed = availability.state === 'failed'
    return (
      <p
        className={`futures-workstation-dock-sync is-${availability.state}`}
        role={failed ? 'alert' : 'status'}
        aria-label={label}
      >
        <span>{availability.notice ?? availability.label}</span>
        {availability.reason === null ? null : <em>{availability.reason}</em>}
        {failed || availability.state === 'stale' ? retry : null}
      </p>
    )
  }

  // Selecting a view reads what that view is made of, once. The review is a
  // reading the desk holds — maintained by the stream and re-read only by the
  // control beside it — and every click here used to cost an account-wide
  // fan-out of about twenty-five requests. Reading both endpoints for a panel
  // that shows one is half that fan-out spent on a view nobody has open, so the
  // view that was opened is what gets read, and only if no read covers it yet.
  const historyStatus = history?.status ?? 'idle'
  const historyReading = historyStatus === 'loading' || historyStatus === 'refreshing'
  const historyReadAt = history?.readAt ?? null
  const historyView = HISTORY_VIEW_OF_TAB[ordersTab] ?? null
  const historyViewRead = historyView === null
    ? null
    : history?.readViews?.[historyView] ?? null
  // Armed until a frame actually leaves. A read that could not be sent — the
  // store still opening, the socket down — is retried when that changes, which
  // is exactly when the callback below is rebuilt.
  const requestedViewsRef = useRef(null)
  if (requestedViewsRef.current === null) requestedViewsRef.current = new Set()
  useEffect(() => {
    if (historyView === null || typeof onLoadHistory !== 'function') return
    if (historyViewRead !== null) {
      // A successful answer completes this request generation. If account
      // rotation or a history reset later clears the read identity while the
      // tab stays selected, that new generation must be allowed to read once.
      requestedViewsRef.current.delete(historyView)
      return
    }
    if (historyReading) return
    if (requestedViewsRef.current.has(historyView)) return
    if (onLoadHistory(selectedSymbol, { views: [historyView] })) {
      requestedViewsRef.current.add(historyView)
    }
  }, [historyReading, historyView, historyViewRead, onLoadHistory, selectedSymbol])

  if (isCollapsed) {
    return (
      <section
        className="futures-workstation-dock is-collapsed"
        aria-label="Futures positions and working orders"
      >
        <div className="futures-workstation-dock-summary" aria-label="Collapsed portfolio dock summary">
          <div className="futures-workstation-dock-summary-title">
            <span>Portfolio</span>
            <strong>Collapsed</strong>
          </div>
          <div className="futures-workstation-dock-summary-reading">
            <span>Positions</span>
            <strong>{positionsAvailability.known ? positions.length : '—'}</strong>
          </div>
          <div className="futures-workstation-dock-summary-reading">
            <span>Working</span>
            <strong>{ordersAvailability.known ? openOrders.length : '—'}</strong>
          </div>
          <FuturesPortfolioUnrealizedTotal
            positions={positions}
            positionsKnown={valuationPositionsKnown}
            snapshot={snapshot}
            store={positionMarkStore}
          />
          <button
            type="button"
            className="futures-workstation-dock-toggle"
            aria-label="Expand portfolio dock"
            aria-expanded="false"
            title="Expand portfolio dock"
            onClick={() => setIsCollapsed(false)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
        </div>
      </section>
    )
  }

  return (
    <section
      ref={dockRef}
      className="futures-workstation-dock"
      aria-label="Futures positions and working orders"
      style={panelHeight === null
        ? undefined
        : { '--fx-dock-panel-height': `${panelHeight}px` }}
    >
      <div
        className="futures-workstation-dock-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize the portfolio dock"
        aria-valuemin={DOCK_PANEL_MIN_HEIGHT}
        aria-valuemax={dockPanelHeightCeiling()}
        aria-valuenow={Math.round(panelHeight ?? DOCK_PANEL_DEFAULT_HEIGHT)}
        tabIndex={0}
        title={'Drag to change how many rows the dock shows. '
          + 'Arrow keys resize; double-click restores the default height.'}
        onPointerDown={beginDockResize}
        onPointerMove={moveDockResize}
        onPointerUp={endDockResize}
        onPointerCancel={endDockResize}
        onKeyDown={keyboardDockResize}
        onDoubleClick={resetDockPanelHeight}
      />
      <div className="futures-workstation-dock-panel">
        <header>
          <div>
            <span>Positions</span>
            <strong>{positionsAvailability.known ? `${positions.length} open` : '— open'}</strong>
          </div>
          <FuturesPortfolioUnrealizedTotal
            positions={positions}
            positionsKnown={valuationPositionsKnown}
            snapshot={snapshot}
            store={positionMarkStore}
          />
          <button
            type="button"
            className="futures-workstation-dock-toggle"
            aria-label="Collapse portfolio dock"
            aria-expanded="true"
            title="Collapse portfolio dock"
            onClick={() => setIsCollapsed(true)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </header>
        {syncState(positionsAvailability, 'Positions synchronization')}
        {positions.length === 0 ? (
          positionsAvailability.known
            ? <p className="futures-workstation-empty">No open positions.</p>
            : null
        ) : (
          <div className="futures-workstation-dock-table" role="table" aria-label="Open positions">
            <div className="futures-workstation-dock-row is-head" role="row">
              <span role="columnheader">Symbol</span>
              <span role="columnheader">Side</span>
              <span role="columnheader">Size (USDT)</span>
              <span role="columnheader">Entry</span>
              <span role="columnheader">Mark</span>
              <span role="columnheader">Liq.</span>
              <span role="columnheader">Margin</span>
              {/* The rule, stated once where the number it governs is read. */}
              <span
                role="columnheader"
                title={'uPnL, ROE and size use the exchange mark. A qualified account '
                  + 'snapshot is shown only while a live mark is unavailable; trades '
                  + 'between marks do not alter these readings.'}
              >
                uPnL (ROE)
              </span>
              {/* What the position has already settled, beside what it would
                  settle if closed now. The two are never added together: one is
                  in the wallet and the other is not. */}
              <span
                role="columnheader"
                title={'What this position has already settled \u2014 realized PnL on the '
                  + 'parts closed out of it, funding, commission, and insurance clearance '
                  + 'if any. Already in the wallet, unlike the uPnL beside it.'}
              >
                PnL
              </span>
              <span role="columnheader" />
            </div>
            {positions.map((position) => {
              const positionKey = futuresTradePositionKey(
                position.symbol,
                position.positionSide ?? 'BOTH',
              ) ?? `${position.symbol}:${position.positionSide ?? 'BOTH'}`
              return (
                <FuturesPortfolioPositionRow
                  key={positionKey}
                  position={position}
                  selected={position.symbol === selectedSymbol}
                  tickSize={tickSizes[position.symbol] ?? null}
                  marginCall={marginCalls[futuresMarginCallKey(position)] ?? null}
                  settled={settledMoney?.[positionKey] ?? null}
                  settledRead={settledRead}
                  settledWindow={settledWindow}
                  snapshot={snapshot}
                  store={positionMarkStore}
                  onClosePosition={onClosePosition}
                  onLeverageEdit={onLeverageEdit}
                  onMarginEdit={onMarginEdit}
                  onSizePick={onSizePick}
                  onSymbolChange={onSymbolChange}
                />
              )
            })}
          </div>
        )}
        {openSharedAdjustments.length === 0 ? null : (
          <section
            className="futures-workstation-dock-shared"
            aria-label="Shared open-position wallet adjustments"
          >
            <header>
              <strong>Shared PnL adjustments</strong>
              <span>Counted once outside position rows</span>
            </header>
            <div role="list">
              {openSharedAdjustments.map((adjustment) => {
                const amounts = (Array.isArray(adjustment?.visibleNet)
                  ? adjustment.visibleNet
                  : []).map(reading => ({ reading, text: signedAssetAmount(reading) }))
                  .filter(item => item.text !== null)
                const scope = adjustment?.symbol
                  ? `${adjustment.symbol}${adjustment.leg ? ` ${adjustment.leg}` : ''}`
                  : 'Account'
                const components = openSharedComponents(adjustment)
                const qualifications = openSharedQualifications(adjustment)
                const identityConflict = (Array.isArray(adjustment?.qualifications)
                  ? adjustment.qualifications
                  : []).some(code => String(code ?? '').trim().toUpperCase() === 'IDENTITY_CONFLICT')
                const ownership = identityConflict
                  ? 'Conflict'
                  : adjustment?.kind === 'unattributedShared'
                    ? 'Unattributed'
                    : 'Shared'
                const ownershipDetail = identityConflict
                  ? 'selected representative is not exact'
                  : ownership === 'Unattributed'
                    ? 'not assigned to a known position scope'
                    : 'not assigned to a single position leg'
                return (
                  <div
                    role="listitem"
                    tabIndex={0}
                    key={futuresSharedAdjustmentKey(adjustment)}
                    aria-label={`${scope} ${ownership.toLowerCase()} adjustment. ${
                      amounts.map(item => item.text).join('. ') || 'Amount unavailable'
                    }. Movement types: ${components.join(', ') || 'unavailable'}. ${
                      qualifications.join('. ')
                    }${qualifications.length > 0 ? '. ' : ''}Counted once outside position rows.`}
                  >
                    <span>{scope}</span>
                    <strong>{amounts.map(item => item.text).join(' · ') || 'Unknown amount'}</strong>
                    <em>{ownership} · {ownershipDetail}</em>
                    <em>Movements: {components.join(' · ') || 'unavailable'}</em>
                    {qualifications.length === 0 ? null : (
                      <em>Qualifications: {qualifications.join(' · ')}</em>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </div>

      <div className="futures-workstation-dock-panel">
        <header>
          <div className="futures-workstation-dock-tabs" role="tablist" aria-label="Order views">
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === 'working'}
              onClick={() => setOrdersTab('working')}
            >
              Working <strong>{ordersAvailability.known ? openOrders.length : '—'}</strong>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === 'orderHistory'}
              onClick={() => setOrdersTab('orderHistory')}
            >
              Order history
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={ordersTab === 'tradeHistory'}
              onClick={() => setOrdersTab('tradeHistory')}
            >
              {/* Named for what it lists, so it cannot be read as a filtered view
                  of the live positions panel above it — which is exactly how it
                  was read when it still showed open rounds. */}
              Closed positions
            </button>
          </div>
          {ordersTab === 'working' ? null : (
            <div className="futures-workstation-dock-history-read">
              {/* How old what is on screen is. Without it a reading held from
                  the start of the session reads exactly like one taken now. */}
              <span
                className="futures-workstation-dock-history-age"
                title={historyReadAt === null
                  ? undefined
                  : `Account history read ${exactFuturesDeskTime(historyReadAt)}`}
              >
                {historyReading
                  ? 'reading…'
                  : historyReadAt === null
                    ? 'not read'
                    : `read ${formatFuturesDeskTime(historyReadAt)}`}
              </span>
              {/* One compact control. The Full read that used to stand beside it
                  was removed on the operator's word (2026-08-23): while the
                  held review says contract discovery did not finish, this one
                  control runs the full discovery read itself, and once the
                  account's contracts are known it goes back to reading only
                  what may have changed. */}
              <button
                type="button"
                className="futures-workstation-dock-close futures-workstation-dock-refresh"
                aria-label="Re-read account history"
                title={history?.discoveryComplete === false
                  ? 'Contract discovery did not finish — this re-read runs the full account discovery'
                  : 'Read only the account history that may have changed'}
                disabled={historyReading || typeof onLoadHistory !== 'function'}
                onClick={() => onLoadHistory?.(selectedSymbol, {
                  ...(history?.discoveryComplete === false ? { full: true } : {}),
                  views: historyView === null ? null : [historyView],
                })}
              >
                ↻
              </button>
            </div>
          )}
        </header>

        {ordersTab !== 'working' ? (
          <FuturesHistoryPanel
            view={ordersTab}
            symbol={selectedSymbol}
            history={history}
            settledIncome={settledIncome}
            tradeRoundIndex={tradeRoundIndex}
            tickSizes={tickSizes}
            onSymbolChange={onSymbolChange}
            onRetrySettledIncome={typeof onRefreshAccount === 'function'
              ? retryAccount
              : undefined}
          />
        ) : openOrders.length === 0 ? (
          <>
            {syncState(ordersAvailability, 'Working orders synchronization')}
            {/* "No working orders" is a claim about the account, and it may only
                be made when a read actually reported none. */}
            {ordersAvailability.known
              ? <p className="futures-workstation-empty">No working orders.</p>
              : null}
          </>
        ) : (
          <>
          {/* Rows the desk holds and nothing has confirmed are still the rows to
              read; what they are is what has to be said beside them. */}
          {syncState(ordersAvailability, 'Working orders synchronization')}
          <div className="futures-workstation-dock-table" role="table" aria-label="Working orders">
            <div className="futures-workstation-dock-row is-head is-orders" role="row">
              <span role="columnheader">Symbol</span>
              <span role="columnheader">Side</span>
              <span role="columnheader">Intent</span>
              <span role="columnheader">Price</span>
              <span role="columnheader">Size (USDT)</span>
              <span role="columnheader">Filled (USDT)</span>
              <span role="columnheader" />
            </div>
            {openOrders.map((order) => {
              const intent = describeFuturesOrderIntent(order)
              const trigger = describeFuturesAlgoTrigger(order)
              // The editor submits to Binance's amend endpoint, which
              // re-states LIMIT orders only — the same promise rule the
              // chart's grip follows. A doorway on a stop read "Edit … order
              // at 0" and the refusal arrived after the form was filled in.
              const editable = futuresOrderPriceIsMovable(order) && typeof onOrderEdit === 'function'
              const restingPrice = priceOf(order.symbol, orderPresentationPrice(order))
              const presentationPrice = trigger.spawnedPrice === null
                ? restingPrice
                : priceOf(order.symbol, trigger.spawnedPrice)
              const executedContracts = order.z ?? order.executedQty
              const displayedTrigger = priceOf(
                order.symbol,
                order.triggerPrice ?? order.price,
              )
              const priceTitle = trigger.triggered
                ? `fired from a trigger at ${displayedTrigger}`
                : displayedTrigger !== '—' && displayedTrigger !== restingPrice
                  ? `activates at ${displayedTrigger}`
                  : undefined
              return (
                <div
                  className={`futures-workstation-dock-row is-orders is-${intent.tone}${order.symbol === selectedSymbol ? ' is-current-symbol' : ''}${editable ? ' is-editable' : ''}${trigger.triggered ? ' is-triggered' : ''}`}
                  role="row"
                  key={`${order.orderKind ?? 'REGULAR'}:${order.symbol}:${order.orderId}`}
                  tabIndex={editable ? 0 : undefined}
                  aria-label={editable
                    ? `Edit ${order.symbol} ${intent.side} order at ${order.price}`
                    : undefined}
                  onKeyDown={editable
                    ? event => openOrderEditorFromKeyboard(event, order, onOrderEdit)
                    : undefined}
                  // Every order surface opens the same editor; the row's own
                  // controls stop the event so Cancel never opens a panel.
                  onClick={editable
                    ? event => onOrderEdit(order, { x: event.clientX, y: event.clientY })
                    : undefined}
                >
                  {/* A fourteen-character contract needs 117px and this track
                      gives it 82 at the width the dock splits, so the name is
                      cut — and giving the intent beside it the room its badge
                      needs takes another ten. The whole name is on the element,
                      as it is in the review. */}
                  <span role="cell">
                    <button
                      type="button"
                      className="futures-workstation-dock-symbol"
                      aria-label={`Show ${order.symbol}`}
                      title={order.symbol}
                      onClick={(event) => {
                        event.stopPropagation()
                        onSymbolChange?.(order.symbol)
                      }}
                    >
                      {order.symbol}
                    </button>
                  </span>
                  <span role="cell" className={`futures-workstation-dock-side is-${intent.tone}`}>
                    {intent.side}
                  </span>
                  {/* The leg says which position the order belongs to; it does
                      not say whether the order opens or closes it. That was left
                      to be worked out from the side colour — true, and only if
                      you already know the rule. The word is one badge wide. */}
                  <span role="cell">
                    {order.orderKind === 'ALGO' ? 'ALGO · ' : ''}{intent.label}
                    {intent.positionEffect === 'EXIT' ? (
                      <em className="futures-workstation-dock-exit" title={exitTitle(intent)}>
                        exit
                      </em>
                    ) : null}
                    {trigger.triggered ? ' · triggered' : ''}
                  </span>
                  {/* A triggered parent is priced at the price it fired at when
                      the exchange states one: its trigger is where it stopped
                      being an order, not where it rests. Both are kept on hover
                      so the row never loses the number it was placed against. */}
                  <span
                    role="cell"
                    title={priceTitle}
                  >
                    {presentationPrice}
                  </span>
                  {/* Sized the way the ticket, the editor and the chart label
                      size it, so one order reads as one number everywhere. The
                      contract count is what the exchange works in, so it stays
                      exact on hover rather than disappearing. */}
                  <span role="cell" title={`${exactText(orderWorkingQuantity(order))} contracts`}>
                    {orderNotionalUsdt(order) ?? '—'}
                  </span>
                  <span
                    role="cell"
                    title={executedContracts === null
                      || executedContracts === undefined
                      || executedContracts === ''
                      ? undefined
                      : `${executedContracts} contracts`}
                  >
                    {orderFilledNotionalUsdt(order) ?? '—'}
                  </span>
                  <span role="cell">
                    {/* Cancel is not offered on an algo at all — the desk lists
                        and cancels them on Binance — and on one that has fired
                        the exchange would refuse it anyway. The cell says which
                        of the two it is, rather than leaving the operator to
                        read an absence. */}
                    {order.orderKind === 'ALGO' ? (
                      <em
                        className="futures-workstation-dock-managed"
                        title={trigger.triggered
                          ? `Fired into order ${trigger.spawnedOrderId}; awaiting confirmation. It is no longer working, so it cannot be moved or cancelled.`
                          : 'Managed on Binance'}
                      >
                        {trigger.triggered ? 'fired' : 'on Binance'}
                      </em>
                    ) : (
                      <button
                        type="button"
                        className="futures-workstation-dock-cancel"
                        aria-label={`Cancel ${order.symbol} ${intent.side} order at ${order.price}`}
                        disabled={typeof onCancelOrder !== 'function'}
                        onClick={(event) => {
                          event.stopPropagation()
                          onCancelOrder?.({ symbol: order.symbol, orderId: order.orderId })
                        }}
                      >
                        Cancel
                      </button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          </>
        )}
      </div>
    </section>
  )
}

export default memo(FuturesPortfolioDock)
