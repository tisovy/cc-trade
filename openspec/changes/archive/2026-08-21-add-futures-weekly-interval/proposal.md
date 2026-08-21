## Why

The Futures chart interval toolbar stops at `1d`, so the operator cannot inspect or page weekly Binance candles from the production workstation. Add the exchange-supported `1w` interval at the end of the existing interval choices without changing the `15m` default or any Spot chart behavior.

## What Changes

- Add a visible `1w` choice immediately after `1d` in the Futures chart interval group and include it in the keyboard interval picker.
- Carry `1w` through the typed renderer protocol, workstation ownership/session selection, production and deterministic transports, and Binance candle stream/history requests.
- Treat one weekly candle as a fixed seven-day exchange interval for Futures history continuity and cache reuse.
- Keep the existing interval order, explicit-selection behavior, history isolation, unsupported-interval rejection, and `15m` default unchanged.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `futures-workstation-presentation`: Extend the selectable Futures chart intervals with an end-to-end weekly (`1w`) reading.

## Impact

- Futures interval UI and keyboard picker driven by the shared interval list.
- Shared workstation protocol validation and the main-process market-contract/transport interval allowlists.
- Futures candle stream selection, history paging, and per-symbol/per-interval history cache continuity.
- Focused renderer, protocol, transport, service, and history-cache tests; no new dependency or external API is introduced.
