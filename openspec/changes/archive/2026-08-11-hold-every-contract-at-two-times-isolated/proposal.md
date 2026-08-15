## Why

On 2026-08-11 the operator opened EPICUSDT and sent an entry carried at 20×,
without knowing it. Nothing on the desk had asked for 20×: it is whatever
Binance's account-wide setting left on a contract this desk had never traded.

Two gaps produced it, and either one alone would have prevented it:

- **The desk reads the leverage of a contract but never sets one.** The change
  `state-and-set-the-leverage` gave the desk `/fapi/v1/symbolConfig` and a
  control to change the multiple, and it deliberately shows nothing where the
  exchange reported nothing. But a contract the operator opens for the first
  time arrives carrying whatever the exchange holds for it. At 20× the margin
  behind a position is a twentieth of its notional and the liquidation price
  sits roughly 5% from entry — on a contract the operator sized in USDT and
  never thought about in multiples.
- **The last panel before the money moves does not state the terms.** The
  confirmation panel (`FuturesOrderConfirmation.jsx`) states the headline, the
  price, the size and the position before and after — everything except what the
  position will be carried at. The one number that turned a 250 USDT entry into
  a position that liquidates on a 5% move was on no surface the operator's eye
  passes on the way to Enter.

The margin mode has the same hole: the desk reads `marginType` and prints ISO or
CROSS, but has no command that sets it. A cross position on a contract that runs
away takes the whole wallet with it; isolated caps the loss at the margin behind
that one position.

## What Changes

- **A contract the desk works on is held at 2× isolated.** When the desk reads a
  contract's configuration and that contract is flat, a multiple above 2 is
  lowered to 2 and a CROSSED mode is moved to ISOLATED, once per contract per
  session. The operator raising it afterwards is the operator's decision and
  stands.
- **The default only ever lowers risk.** A contract already at 1× is left at 1×
  — the desk does not raise a multiple nobody asked it to raise. A contract
  carrying an open position is never touched: changing its leverage would move
  the liquidation price of money already at risk.
- **New typed command `trade.setMarginType`.** The desk could read the margin
  mode and could not set it. It travels the same validated command path as
  `trade.setLeverage`, names its contract explicitly, and is refused while
  trading is paused.
- **The confirmation states the leverage.** The multiple the entry will be
  carried at is stated in the confirmation panel, large, in the same yellow the
  desk already reserves for the liquidation reading — and stated as unknown, not
  as a number, where the exchange has not reported it.

## Non-Goals

- Setting a default for contracts the desk is not working on. This applies to the
  contract in hand, when its configuration is read, not to a sweep of the account.
- Overriding the operator. A multiple the operator sets by hand is never revised
  by the desk afterwards, in this session or by re-selecting the contract.
- Refusing an order because its leverage is high. The desk states the multiple;
  it does not gate on it.
