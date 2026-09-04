import React, { useState, useMemo, useEffect, useCallback } from 'react'
import './InfoPanel.css'
import { timeParse, timeFormat } from 'd3-time-format'
import { calculatePrecision, precisionTruncate } from '../../utils/operations'
import { useDataContext } from '../../context/DataContext'
import { calculatePnL, resetPnL, getTimeRangeLabel } from '../../utils/pnl'

const parseFormat = timeParse('%Q')
const formatTime = timeFormat('%d %b %H:%M:%S')

const InfoPanel = ({ handleRequest }) => {
    const {
        panel,
        balances,
        spotAccountFingerprint,
        orders,
        history: _history,
        filters,
        ticker,
        marketHistory,
        handlePanelUpdate,
    } = useDataContext();
    const [menu, setMenu] = useState('orders')
    const [pnlPeriod, setPnlPeriod] = useState('day')
    const [heldPnL, setPnlData] = useState(null)
    const pnlData = spotAccountFingerprint && heldPnL?.fingerprint === spotAccountFingerprint
        && heldPnL?.period === pnlPeriod && Object.keys(balances ?? {}).length > 0 ? heldPnL.data : null
    const [pnlRefreshKey, setPnlRefreshKey] = useState(0)

    // Calculate P&L when period changes or balances/ticker update
    useEffect(() => {
        if (menu === 'pnl' && spotAccountFingerprint && balances && ticker && ticker.length > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setPnlData({ fingerprint: spotAccountFingerprint, period: pnlPeriod,
                data: calculatePnL(pnlPeriod, balances, ticker, spotAccountFingerprint) });
        }
    }, [menu, pnlPeriod, balances, ticker, pnlRefreshKey, spotAccountFingerprint]);

    const handlePnlReset = useCallback(() => {
        if (spotAccountFingerprint && balances && ticker) {
            resetPnL(pnlPeriod, balances, ticker, spotAccountFingerprint);
            setPnlData({ fingerprint: spotAccountFingerprint, period: pnlPeriod,
                data: calculatePnL(pnlPeriod, balances, ticker, spotAccountFingerprint) });
            setPnlRefreshKey(prev => prev + 1);
        }
    }, [pnlPeriod, balances, ticker, spotAccountFingerprint]);

    const handleMenuClick = (e) => {
        // Use id from the clicked element
        const id = e.target.id;
        if (['balances', 'orders', 'market-history', 'pnl'].includes(id)) {
            if (id === 'market-history') setMenu('market_history');
            else setMenu(id);
        }
    }

    const handlePairClick = (e) => {
        let selected = e.target.getAttribute('symbol')
            ? e.target.getAttribute('symbol')
            : e.target.parentNode.getAttribute('symbol')
        // if order is not currently opened in chart - make a call for it
        if (selected && selected !== panel.selected) {
            handlePanelUpdate({ ...panel, selected }, true)
        }
    }

    const handleCoinClick = (e) => {
        const rawCoin = e.target.getAttribute('symbol')
        if (!rawCoin) return;
        const coin = rawCoin.toUpperCase()

        let nextSymbol
        if (coin === 'USDT' || coin === 'BTC') {
            nextSymbol = 'BTCUSDT'
        } else {
            nextSymbol = `${coin}USDT`
        }

        if (nextSymbol && nextSymbol !== panel.selected) {
            handlePanelUpdate({ ...panel, selected: nextSymbol, market: 'USDT' }, true)
        }
    }

    const handleCancelOrderClick = (e, id, symbol) => {
        e.preventDefault()
        handleRequest({ id, symbol }, 'cancel')
    }

    const compoundOrder = (order, filters, market, maxTotal, index, marketValueDecimals) => {
        const precision = calculatePrecision(filters[order.symbol])

        const t = parseFormat(order.time)
        const p = parseFloat(order.price)
        const q = parseFloat(order.origQty)
        const isSell = order.side === 'SELL'
        const s = order.symbol
        const orderId = order.orderId

        const total = p * q
        const formattedTime = formatTime(t)
        const formattedTotal = precisionTruncate(total, marketValueDecimals).toFixed(marketValueDecimals)
        const formattedPrice = precisionTruncate(p, precision.price).toFixed(precision.price)

        return (
            <div
                key={index}
                className={`order-card ${isSell ? 'sell' : 'buy'}`}
            >
                <div className="order-card-header">
                    <span className={`order-card-side ${isSell ? 'sell' : 'buy'}`}>
                        {isSell ? 'SELL' : 'BUY'}
                    </span>
                    <span
                        className="order-card-symbol"
                        symbol={s}
                        onClick={handlePairClick}
                    >
                        {s}
                    </span>
                    <span
                        className="order-card-cancel"
                        onClick={(e) => handleCancelOrderClick(e, orderId, s)}
                    >
                        ×
                    </span>
                </div>
                <div className="order-card-details">
                    <div className="order-card-main">
                        <span className="order-card-price">{formattedPrice}</span>
                        <span className="order-card-total">@ {formattedTotal} {market}</span>
                    </div>
                    <span className="order-card-time">{formattedTime}</span>
                </div>
            </div>
        )
    }

    const compoundEntry = (entry, market, tickerMap, btcTicker, filters, index, marketValueDecimals) => {
        let total,
            precision = {},
            n = entry[0],
            a = parseFloat(entry[1].available),
            o = parseFloat(entry[1].onOrder),
            coinData = tickerMap.get(n + market)

        // make sure to have proper precision filters for BTC and USDT
        switch (n) {
            case 'BTC':
                precision = calculatePrecision(filters[n + 'USDT'])
                break
            case 'USDT':
            case 'USDC':
            case 'USDS':
                precision = calculatePrecision(filters['BTC' + n])
                break
            default:
                // catch error with no filters for specific coins or airdrop tokens
                if (filters[n + market]) {
                    precision = calculatePrecision(filters[n + market])
                } else {
                    precision.quantity = market === 'BTC' ? 1 : 4
                }
        }

        // check if we have data for this coin + if we have enough amount to show
        if (coinData) {
            total = (a + o) * parseFloat(coinData.lastPrice)
            if (market === 'BTC') {
                if (total < 0.001) {
                    return null
                }
            } else {
                if (total < 5) {
                    return null
                }
            }
        } else if (a + o > 0.001) {
            // calculate BTC and USDT precision or show total of 0 if we dont have a price in ticker
            if (n === 'BTC') {
                total = a + o
            } else if (n === 'USDT') {
                if (market === 'BTC') {
                    total = (a + o) / parseFloat(btcTicker.lastPrice)
                } else {
                    total = a + o
                }
            } else {
                total = 0
            }
        } else {
            return null
        }

        a = precisionTruncate(a, precision.quantity).toFixed(precision.quantity)
        o = precisionTruncate(o, precision.quantity).toFixed(marketValueDecimals)

        total = precisionTruncate(total, marketValueDecimals).toFixed(marketValueDecimals)

        return (
            <div className="entity" key={index}>
                <span className="piece clickable" symbol={n} onClick={handleCoinClick}>
                    {n}
                </span>
                <span className="piece">{a}</span>
                <span className="piece">{o}</span>
                <span className="piece">{total}</span>
            </div>
        )
    }

    const compoundHistoryEntry = (entry, index) => {
        return (
            <div className="entity" key={index}>
                <span
                    className="piece full clickable"
                    symbol={entry}
                    onClick={handlePairClick}
                >
                    {entry}
                </span>
            </div>
        )
    }

    const market = panel.market
    const marketValueDecimals = market === 'BTC' ? 6 : 0
    let feed, maxTotal, entriesInfo, entryTotal, currencyTotal

    const tickerMap = useMemo(() => {
        const map = new Map();
        ticker.forEach(item => {
            if (item && item.symbol) {
                map.set(item.symbol, item);
            }
        });
        return map;
    }, [ticker]);

    let btcTicker = tickerMap.get('BTCUSDT')

    // sort orders by time
    const sortedOrders = [...orders].sort((a, b) => b.time - a.time)

    switch (menu) {
        case 'balances':
            entriesInfo = (
                <div className="header">
                    <div className="item">Coin</div>
                    <div className="item">Available</div>
                    <div className="item">On Order</div>
                    <div className="item">Total</div>
                </div>
            )
            feed = Object.entries(balances)
                .map((entry, index) =>
                    compoundEntry(entry, market, tickerMap, btcTicker, filters, index, marketValueDecimals)
                )
                .filter(Boolean)

            if (feed.length > 0) {
                maxTotal = feed
                    .map((entry) => parseFloat(entry.props.children[3].props.children))
                    .reduce((a, b) => a + b, 0)

                if (market === 'BTC') {
                    const crossDecimals = 2
                    currencyTotal =
                        precisionTruncate(
                            maxTotal * parseFloat(btcTicker?.lastPrice || 0),
                            crossDecimals
                        ).toFixed(crossDecimals) + ' USDT'
                    maxTotal = precisionTruncate(maxTotal, marketValueDecimals).toFixed(marketValueDecimals)
                } else {
                    const crossDecimals = 6
                    currencyTotal =
                        precisionTruncate(
                            maxTotal / parseFloat(btcTicker?.lastPrice || 1),
                            crossDecimals
                        ).toFixed(crossDecimals) + ' BTC'
                    maxTotal = precisionTruncate(maxTotal, marketValueDecimals).toFixed(marketValueDecimals)
                }
                entryTotal = (
                    <div className="entity sums">
                        <div className="piece-3x">Sum</div>
                        <div className="piece-3x">{currencyTotal}</div>
                        <div className="piece-3x">
                            {maxTotal} {market}
                        </div>
                    </div>
                )
            }
            break
        case 'orders':
            if (sortedOrders.length > 0) {
                maxTotal = Math.max.apply(
                    Math,
                    sortedOrders.map(
                        (item) => parseFloat(item.origQty) * parseFloat(item.price)
                    )
                )
                feed = (
                    <div className="orders-container">
                        {sortedOrders.map((order, index) =>
                            compoundOrder(order, filters, market, maxTotal, index, marketValueDecimals)
                        )}
                    </div>
                )
            } else {
                feed = <div className="color-white">No open orders</div>
            }
            break
        case 'market_history':
            if (marketHistory && marketHistory.length > 0) {
                feed = marketHistory.map((pair, index) => compoundHistoryEntry(pair, index))
            } else {
                feed = <div className="color-white">No market history</div>
            }
            break
        case 'pnl': {
            const isPositive = pnlData && pnlData.pnl >= 0;
            const pnlColor = isPositive ? '#26a69a' : '#ef5350';

            feed = (
                <div className="pnl-container">
                    <div className="pnl-period-selector">
                        {['day', 'week', 'month', 'all'].map(period => (
                            <button
                                key={period}
                                className={`pnl-period-btn ${pnlPeriod === period ? 'active' : ''}`}
                                onClick={() => setPnlPeriod(period)}
                            >
                                {period === 'all' ? 'All' : period.charAt(0).toUpperCase() + period.slice(1)}
                            </button>
                        ))}
                    </div>

                    <div className="pnl-time-label">
                        {getTimeRangeLabel(pnlPeriod, null, spotAccountFingerprint)}
                    </div>

                    {pnlData && pnlData.hasSnapshot && (
                        <>
                            {/* USDT P&L */}
                            <div className="pnl-main-value" style={{ color: pnlColor }}>
                                <span className="pnl-sign">{isPositive ? '+' : ''}</span>
                                <span className="pnl-amount">
                                    {precisionTruncate(pnlData.pnl, 2).toFixed(2)}
                                </span>
                                <span className="pnl-currency">USDT</span>
                            </div>

                            {pnlData.pnlPercent !== 0 && (
                                <div className="pnl-percent" style={{ color: pnlColor }}>
                                    {isPositive ? '+' : ''}{pnlData.pnlPercent.toFixed(2)}%
                                </div>
                            )}

                            {/* BTC P&L */}
                            <div className="pnl-btc-section">
                                <div className="pnl-btc-value" style={{ color: pnlData.pnlBTC >= 0 ? '#f7931a' : '#ef5350' }}>
                                    <span className="pnl-sign">{pnlData.pnlBTC >= 0 ? '+' : ''}</span>
                                    <span className="pnl-amount">
                                        {precisionTruncate(pnlData.pnlBTC, 6).toFixed(6)}
                                    </span>
                                    <span className="pnl-currency">BTC</span>
                                </div>
                                {pnlData.pnlBTCPercent !== 0 && (
                                    <div className="pnl-btc-percent" style={{ color: pnlData.pnlBTC >= 0 ? '#f7931a' : '#ef5350' }}>
                                        {pnlData.pnlBTC >= 0 ? '+' : ''}{pnlData.pnlBTCPercent.toFixed(2)}%
                                    </div>
                                )}
                            </div>

                            <div className="pnl-stats">
                                <div className="pnl-stat">
                                    <span className="pnl-stat-label">Start</span>
                                    <span className="pnl-stat-value">
                                        {precisionTruncate(pnlData.startValue, 2).toFixed(2)}
                                    </span>
                                </div>
                                <div className="pnl-stat">
                                    <span className="pnl-stat-label">Current</span>
                                    <span className="pnl-stat-value">
                                        {precisionTruncate(pnlData.currentValue, 2).toFixed(2)}
                                    </span>
                                </div>
                                <div className="pnl-stat">
                                    <span className="pnl-stat-label">Trades</span>
                                    <span className="pnl-stat-value">{pnlData.tradeCount}</span>
                                </div>
                            </div>

                            <div className="pnl-stats btc">
                                <div className="pnl-stat">
                                    <span className="pnl-stat-label">Start ₿</span>
                                    <span className="pnl-stat-value btc">
                                        {precisionTruncate(pnlData.startValueBTC, 6).toFixed(6)}
                                    </span>
                                </div>
                                <div className="pnl-stat">
                                    <span className="pnl-stat-label">Current ₿</span>
                                    <span className="pnl-stat-value btc">
                                        {precisionTruncate(pnlData.currentValueBTC, 6).toFixed(6)}
                                    </span>
                                </div>
                                <div className="pnl-stat">
                                    <span className="pnl-stat-label">BTC Price</span>
                                    <span className="pnl-stat-value">
                                        {precisionTruncate(pnlData.btcPrice, 0).toFixed(0)}
                                    </span>
                                </div>
                            </div>

                            <button className="pnl-reset-btn" onClick={handlePnlReset}>
                                Reset {pnlPeriod === 'all' ? 'All' : pnlPeriod.charAt(0).toUpperCase() + pnlPeriod.slice(1)}
                            </button>
                        </>
                    )}

                    {pnlData && !pnlData.hasSnapshot && (
                        <div className="pnl-no-snapshot">
                            <div className="pnl-current-value">
                                {precisionTruncate(pnlData.currentValue, 2).toFixed(2)} <span className="usdt">USDT</span>
                            </div>
                            <div className="pnl-current-value btc">
                                {precisionTruncate(pnlData.currentValueBTC, 6).toFixed(6)} <span className="btc">BTC</span>
                            </div>
                            <p className="pnl-hint">
                                Click the button below to start tracking P&L from now
                            </p>
                            <button className="pnl-reset-btn primary" onClick={handlePnlReset}>
                                Start Tracking {pnlPeriod === 'all' ? '' : pnlPeriod.charAt(0).toUpperCase() + pnlPeriod.slice(1)}
                            </button>
                        </div>
                    )}

                    {!pnlData && (
                        <div className="pnl-empty">{spotAccountFingerprint ? 'Loading balance data...' : 'Waiting for account identity...'}</div>
                    )}
                </div>
            )
            break
        }
        default:
            feed = ''
    }

    return (
        <div className="info-panel">
            <div className="header">
                <div
                    id="market-history"
                    className={
                        'item ' + (menu === 'market_history' ? 'selected' : '')
                    }
                    onClick={handleMenuClick}
                >
                    Journal
                </div>
                <div
                    id="orders"
                    className={
                        'item ' + (menu === 'orders' ? 'selected' : '')
                    }
                    onClick={handleMenuClick}
                >
                    Orders
                </div>
                <div
                    id="pnl"
                    className={
                        'item ' + (menu === 'pnl' ? 'selected' : '')
                    }
                    onClick={handleMenuClick}
                >
                    P&L
                </div>
                <div
                    id="balances"
                    className={
                        'item ' + (menu === 'balances' ? 'selected' : '')
                    }
                    onClick={handleMenuClick}
                >
                    Balances
                </div>
            </div>
            <div className="feed">
                {entriesInfo}
                {feed}
                {entryTotal}
            </div>
        </div>
    )
}

export default InfoPanel;
