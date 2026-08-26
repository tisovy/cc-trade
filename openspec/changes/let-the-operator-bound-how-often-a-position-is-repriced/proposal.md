# Let the operator bound how often a position is repriced

## Why

The operator, 2026-08-26, on the change that put every open position on its
contract's own printed price:

> *"отлично, теперь обновление было вообще REALTIME — СУПЕР! Но я бы предложил
> ограничить его значением таймаута которое выставлено в меню Aggregate
> Trades."*

The behaviour is right and the rate is theirs to choose. The desk already has
the dial: **Aggregate trades → Throttle / Timeout (ms)**, an operator control
with a validated range of 16–5000 ms and a default of 250, which until now
bounded only how often the trade list redrew. Adding a second number for the
position rows would put two controls on the desk for one question — how much of
this market do I want drawn — and leave the operator to keep them in step.

The measured rate it is bounding: BTCUSDT prints 25.5 times a second, and the
feed's own coalescing window let that become up to 40 publications a second,
each one a full frame across IPC and a re-render of every position row and the
dock total. At the menu's default that becomes four a second.

## What Changes

- The position price feed's print publication window follows the Aggregate
  trades setting: throttled at that timeout, unthrottled at the feed's own
  coalescing window. The window is applied as a gate — the first print of a move
  publishes on the coalescing window, so a move that starts is seen at once, and
  what follows is spaced by the operator's bound. Nothing is dropped; the newest
  price is held and published when the gate opens.
- **Marks are deliberately not bounded by it.** A mark arrives once a second,
  which is already slower than anything that menu can be set to, and it is the
  reading funding, margin and liquidation are decided on. The menu allows five
  seconds; applying that to the mark would make the slowest number on the desk
  slower still.
- The menu says what it now reaches, and what it does not.

## Non-goals

**The minimum trade size does not reach the positions.** In the trade list it
answers "which prints are worth drawing"; a position is worth what the contract
traded at, and a small trade is as real a price as a large one.

**No second control.** The operator asked for this one to bound both, and one
number in one place is the whole point.

## Risks

A dial that reaches beyond its own panel is a trap for whoever moves it next —
including the operator six months from now, turning the tape down to read the
trade list and quietly slowing their position rows with it. The menu states both
effects, and the feed's floor means the setting can never make the positions
slower than the mark they would otherwise sit on.
