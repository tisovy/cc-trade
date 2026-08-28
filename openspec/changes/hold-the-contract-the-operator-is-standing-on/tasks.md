# Tasks

## 0. Measured first, 2026-08-28

- `fapi/v1/exchangeInfo` через прокси деска: `龙虾USDT`, `币安人生USDT`,
  `我踏马来了USDT` — все `TRADING PERPETUAL`, `pair` тоже CJK, ASCII-алиаса нет.
- Стримы CJK-имени живые на путях деска: `/market/stream` (aggTrade, kline) и
  `/public/stream` (`@depth@100ms`) отдают кадры мгновенно в percent-encoded
  форме — той самой, которую шлёт транспорт. REST klines с
  `symbol=%E9%BE%99%E8%99%BEUSDT` отвечает 200. Транспорт невиновен.
- Журнал -002 за день торговли парой: `grep 龙虾` → **0 строк**; при этом
  каждые 15–20 с шёл цикл `DEPTH_BAND_WALKED` → `CROSSED_ORDER_BOOK` → полный
  `aggregate-ready` (1.6–2.3 с), `deferred` держал spent 770–800/800, urgent
  ждали до 2.4 с.
- Рестарт 18:44:38Z открыл VELVETUSDT (статусы в журнале), оператор был на
  龙虾USDT; повторно 18:45:25Z. `lastSymbol` в localStorage не мог держать CJK.
- 812 задвоенных строк журнала 15:47Z–17:58Z сквозь два рестарта; сокеты
  рендерера никем не считались.

## 1. Implementation

- [x] 1.1 `futuresSymbolHistory`: identity-алфавит протокола
      (`[\p{Lu}\p{Lt}\p{Lo}\p{N}]`, датированная поставочная форма), тесты
      кусались против старого кода (CJK и `BTCUSDT_260929` падали).
- [x] 1.2 `desk-diagnostic-record`: `SYMBOL` тем же алфавитом; `symbol`
      (optional) на `fault` и `timing`; новые виды `display`
      (symbol-shown/workspace-mounted/workspace-unmounted, cause ∈
      {operator, restored}) и `link` (renderer-connected/disconnected +
      connections). Старые точные ассерты форм обновлены (`symbol: null`).
- [x] 1.3 Сервис воркстанции: все 10 точек `onInternalError` и
      `aggregate-ready`-тайминг несут `session.symbol`; `release(step, symbol)`.
- [x] 1.4 `binance-connection`: форвардеры timing/fault протягивают символ;
      обработчик `report_display_event` рядом с `report_frame_marks` (до
      credential-гейта, валидация — правила полей записи); `link`-строки в
      accept/close рендерер-сокета со счётчиком.
- [x] 1.5 `FuturesProductionWorkstation`: репортёр display-событий на рефах
      (mount-строка один раз на реальный маунт, не на смену идентичности
      сокета); `handleSymbolChange` метит `cause: operator`, остальное —
      `restored`.
- [x] 1.6 Тикет: `selectedContractUntradableListing` (жив + PERPETUAL +
      TRADING + tradable=false) → гейт LISTING с честной причиной.
- [x] 1.7 Сторож `check-futures-workstation-boundaries` обновлён под новую
      сигнатуру фолт-репортёра.
- [x] 1.8 Полный прогон: 128 файлов, 2956 тестов зелёные; линт чистый;
      command-path / futures-production / runtime-mock / circular пройдены.

## 2. Operator verification (runbook)

После перезапуска деска (`npm run e`), на живом рынке:

- [ ] 2.1 Открыть 龙虾USDT. Тикет должен показывать **LISTING** и причину про
      execution path — не «Select an active USDⓈ-M contract».
- [ ] 2.2 `grep 龙虾 ~/.config/cc-trade/diagnostics/desk-<today>-*.jsonl` —
      строки `status` (loading/live/resynchronizing) должны появиться.
- [ ] 2.3 Если цикл пересборок повторится — фолты `book-recovery`/`stream` и
      тайминг `aggregate-ready` теперь несут `symbol`: назвать, чья сессия
      штормит (показанная или held из пула).
- [ ] 2.4 Оставить деск на 龙虾USDT, перезапустить: деск обязан открыться на
      龙虾USDT, не на предыдущей ASCII-паре.
- [ ] 2.5 В журнале при каждом ремаунте: `display` symbol-shown с
      `cause:"restored"`, mounted/unmounted парой, и `link`-строки с
      `connections:1`. `connections:2` при одном окне — второй слушатель,
      сообщить.
