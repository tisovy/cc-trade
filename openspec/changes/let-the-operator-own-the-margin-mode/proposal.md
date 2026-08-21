## Why

The desk changes the margin mode of the operator's contracts, never states what mode
they are in, and offers no way to set it.

On 2026-08-21 the operator set a contract to cross ×1 in Binance's own app. The desk
had been down since 09:02Z; it started again at 18:55:17Z, read the contract, found
`CROSSED`, and sent it back to `ISOLATED`. Three configuration changes reached the
exchange in the six minutes after that startup — `trade.setLeverage` on ONGUSDT at
18:55:36Z, `trade.setMarginType` on BEATUSDT at 18:59:39Z, and both together on
PEOPLEUSDT at 19:01:10.693Z and .694Z — every one of them `ok`, and not one of them
asked for (`~/.config/cc-trade/diagnostics/desk-2026-08-21-000.jsonl`). The desk's
"once per contract per session" guard is what is supposed to stop it arguing with the
operator, and a restart re-arms it.

The reversal is hard to see, because nothing on the desk states the mode. `ISO`/`CROSS`
is printed only on an open position's row. The contract in hand shows a multiple and
nothing else, and the confirmation panel — the last surface read before an order goes —
names the multiple but not the mode, which is what decides whether a loss is capped at
that position's margin or stands against the whole wallet.

It is hard to correct, because there is no control. `trade.setMarginType` is typed,
validated, executed with `-4046` handled, and specified; its only caller is the
automatic default.

And it is invisible when it drifts. Binance carries no per-contract margin mode on the
authenticated stream at all: `ACCOUNT_CONFIG_UPDATE` carries a pair's leverage in `ac`
and the account's Multi-Assets switch in `ai.j`, and nothing else. A mode changed in the
exchange's app on a contract the operator is flat in is announced by nothing, and only a
read finds it — but the desk re-reads a configuration only when the operator selects the
contract, or when that contract holds a position or a working order. An order sent
against a stale mode is not refused: Binance fills it at the mode the account actually
holds, so the send teaches the desk nothing, while the account's free-margin estimate is
computed from the mode the desk wrongly believes.

The leverage control beside it has the same two faults, found when the operator checked
this change against the live exchange on the evening of 2026-08-21. It promises a
consequence the exchange does not deliver: on a contract they were holding, they raised
1× to 2×, were told the position's liquidation price was moving closer to the mark, and
watched nothing move. It should not have said so — the liquidation price this desk draws,
and reconciles against the exchange's own figure to 0 bps on that same contract, is
computed from the margin behind the position, the contract's maintenance rate and, in
cross, the whole wallet, and the multiple is in none of those terms. And it offers a
change the exchange refuses outright: putting the multiple back to 1× a minute later
answered `-4161 ISOLATED_LEVERAGE_REJECT_WITH_POSITION` — *"Leverage reduction is not
supported in Isolated Margin Mode with open positions"* — a rule whose every input, the
position, the mode and the direction, the desk was already holding. The refusal it
recorded named no contract, because these two commands carry no order identity and
nothing put one in.

Two further defects keep a stale mode alive longer than the hold intends. A leverage
frame restarts the freshness stamp for the whole held configuration, including the
margin mode the frame never carried. And the renderer's copy of that configuration is
merged and never dropped, so it outlives the backend's own — which is forgotten when the
market is deactivated or the credentials change.

## What Changes

- State the margin mode beside the contract on the order ticket, and on the confirmation
  panel beside the multiple, so the terms an entry is taken on are readable before it is
  sent rather than only after a position exists.
- Make that reading the control: one chip that toggles `ISOLATED` and `CROSSED` for the
  named contract. Where the desk already knows the exchange will refuse — a position
  (`-4048`) or a working order (`-4047`) on that contract — it states the reason instead
  of spending a signed request on a refusal.
- Stop the desk from changing the margin mode by itself. The mode is a choice about how
  risk is carried, not an amount of it, and a desk that reverts it at every restart makes
  the new control worthless.
- Lower the automatic leverage default from 2× to 1×, keeping every rule that bounds it:
  only downwards, only on a flat contract, once per contract per session.
- Give the leverage panel the same treatment as the mode chip: state what a change
  actually does to a position already open — it sets what the exchange requires, not what
  is already standing behind it — and refuse the one change the exchange refuses (`-4161`,
  a lower multiple on an isolated contract holding a position) rather than offering it and
  spending a signed request to be told.
- Name the contract on a refused leverage or margin-mode change, in the desk's record as
  well as on screen: these commands carry no order identity, so without it the record says
  only that something was refused.
- Make the startup read the one the desk can be held to: both fields, for the contract it
  starts on, sent once the local backend is listening and issued again if it failed,
  rather than attempted once and abandoned. Until it lands, both readings are stated as
  unknown rather than as a multiple and isolated.
- Stamp freshness only for what a frame actually carried, and drop the renderer's held
  configurations whenever the backend drops its own.

## Scope

The operator's own working rule bounds this: while the desk is running, they do not change
leverage or margin mode in the exchange's app. That is what makes the startup read
load-bearing and drift-detection unnecessary — nothing here promises to notice a change
made elsewhere mid-session, and the desk states what it read rather than claiming to be
current. What it does promise is that the reading exists before the contract is traded,
that it is visible, and that the desk does not overwrite it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `futures-contract-leverage`: state and change the margin mode from the desk, hold the
  automatic default to the multiple alone, and keep a held configuration honest about how
  recently each of its two fields was read.

## Impact

Affected areas: `futuresContractDefaults`, `useFuturesContractDefaults`,
`FuturesTradingTicket`, `FuturesLeverageEditor`, `FuturesProductionWorkstation`,
`futuresOrderConfirmation`, `useFuturesTrading`, `binance-connection`'s Futures symbol
configuration cache, and their tests.

The behavioural blast radius is larger than the call graph: the automatic margin-mode
change is removed, so contracts the operator holds in cross stay in cross, and the
default multiple every untouched contract lands on becomes 1× — at which the buying
power the leverage panel states equals the wallet rather than twice it.
