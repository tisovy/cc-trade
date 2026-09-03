# Load the rest in a free minute

## Why

The operator, 2026-09-03, after the audit of `c62242d`/`a904662`/`bce9043`/
`9604090`: «переподключать фоновые — я запрещаю. Нам нужен lazy-load.
Активный — всегда считаем, остальные нет … если начинается жесть и резкие
пробои, апп начинает глючить, и я его перезагружаю — то перезагружались
только активные данные с последнего активного графика. Остальное можно
грузить позже, в другие свободные минуты».

What the desk does today: it holds eight contracts and shows one, and every
held session is «a whole session, shown or not» — it reconnects on its own
ladder when its socket drops (`scheduleResync`, eight fast attempts then a
slow one), rebuilds its book when the stream gaps or crosses, and each
rebuild is a full bootstrap: a 1000-level depth page at weight 20 (raised
from 2 by `a904662`, the operator's ruling), two kline reads, a premium and
a ticker read, three sockets through the proxy. In a proxy storm — the three
`SOCKET_CLOSED` of 2026-09-02 each followed four to eight seconds of upstream
lag — seven background sessions ask for that at once, 160 weight against a
public budget of 600, in front of the one contract the operator is trading.

Four more findings from the same audit are carried here rather than left as
residuals:

1. **The summary counts a crossed book twice.** A crossing raises evidence
   under phase `stream` and again under `book-recovery` when the recovery
   round starts outside its cooldown; `read-desk-record.mjs` counts both
   (`Crossed books by contract` reads 2 for 1). Reproduced by feeding the
   summarizer two lines for one crossing.
2. **`lastUpdateId` on the evidence line duplicates `finalUpdateId`** —
   assigned after the diff is applied. The book's identity before the diff
   is what a reader wants.
3. **«The chart never goes blank» is proved on the chart's props.** The
   chart itself clears both series when its generation changes
   (`FuturesWorkstationChart.jsx:399`) and redraws only when the `candles`
   reference changes; through a switch the view hands it the same array. It
   works today because the container's interval state and the hook's state
   land in two renders and the reference changes in between. That is an
   accident of effect order, not a rule.
4. **The account limiter's skew headroom fell from 1 600 to about 100**
   (1 700 + 600 against 2 400). Not retuned here: the record does not yet
   say whether the exchange has refused anything, and the summary tool has
   no line for a `429`/`418`.

## What Changes

- **The shown contract is the only one the desk keeps current on its own
  account.** It reconnects on its ladder, recovers its book, and is
  rebuilt at once when the operator reloads or selects it. Nothing changes
  for it.
- **A background contract never reconnects or reads on its own.** A held
  session that is not shown and loses its stream, fails its freshness rule,
  or needs a book recovery is *parked*: sockets closed, timers cleared, its
  last state kept with the reason. It issues no REST read and opens no
  socket until it is selected — then it is rebuilt at once, taking the
  screen — or until a free minute.
- **A free minute loads one parked contract.** A warmer wakes one parked
  session at a time, most recently shown first, only while the shown
  session is live and bootstrapped, the public read budget has a stated
  amount of room, and a floor has passed since the last wake. Never during
  the shown contract's own bootstrap or recovery.
- **A reload rebuilds the shown contract only.** Stated as a requirement so
  the subscribe path keeps delivering a held session without a bootstrap and
  never touches the others.
- **The chart redraws what it is handed on a generation change**, not what
  an intermediate render happened to pass.
- **One evidence line per crossing**, with the book's identity from before
  the diff; the summary counts each once and lists the exchange's own
  refusals (`429`/`418`) by route.
- **The record sees a parking and a wake** as lines of their own.

## Impact

- Specs: `futures-workstation-presentation` («A held session is a whole
  session, shown or not» and «A market feed keeps trying while its contract
  is wanted» scoped to the shown contract; background parking, the free
  minute and the reload stated; the chart's redraw on a generation change),
  `desk-diagnostic-record` (park and wake lines; one evidence line per
  crossing; the summary's crossing count and exchange refusals).
- Code: `electron/services/futures-production-workstation-service.js`
  (`handleDisconnect`, `scheduleResync`, `startFreshnessMonitor`,
  `recoverBook` gated on `isShown`; `parkSession`, the warmer),
  `electron/services/futures-production-workstation-transport.js` (a room
  reading of the public budget), `electron/services/futures-workstation-order-book.js`
  (`lastUpdateId` before the diff), `scripts/read-desk-record.mjs`
  (crossings once, refusals), `src/components/features/futures/FuturesWorkstationChart.jsx`
  (redraw on generation), `desk-diagnostic-record.js` (phases declared).
- Not touched: the shown session's ladder and cooldowns, the pool bound
  (8) and its eviction order, the account limiter's ceilings (observed
  first through the refusal line), the fill-burst timer (operator's
  ruling), the book's decimal ordering (a second string form of one price
  is not something the exchange sends; noted, not owned).
