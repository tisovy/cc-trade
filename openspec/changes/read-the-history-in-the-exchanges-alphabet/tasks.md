# Tasks

## 0. Measured first, 2026-08-28

- Терминал оператора: `[futures-history] 龙虾USDT request failed: A valid
  expected trade-history symbol is required` — пачками по 5 после каждого
  aggregate-ready, ретраи бесконечные. Ордера на паре стоят (бинанс-апп),
  сделки на аккаунте есть — читать их деск отказывался до первого запроса.
- Подпись/провод невиновны: `toQueryString` (URLSearchParams) даёт одну и ту
  же percent-encoded строку в HMAC и в URL; маркет-REST с CJK-символом уже
  подтверждён живой пробой.
- Единственный затвор — `/^[A-Z0-9_]+$/` в
  `normalizeFuturesTradeHistorySymbol` (общая точка: window, adapter, ledger).

## 1. Implementation

- [x] 1.1 `normalizeFuturesTradeHistorySymbol` → identity-алфавит протокола
      (`[\p{Lu}\p{Lt}\p{Lo}\p{N}_]`, флаг `u`), предел 32 символа сохранён.
- [x] 1.2 Тесты кусались: чтение окна с `expectedSymbol: 龙虾USDT` падало
      ровно живой ошибкой; `FOREIGN_TRADE_SYMBOL` против юникодного ожидания
      сохранён отдельным тестом. Оба красные до правки, зелёные после.
- [x] 1.3 Ассеты оставлены ASCII намеренно (USDT/BNB/FDUSD — денежная
      граница), исполнение не тронуто.

## 2. Operator verification (runbook)

- [ ] 2.1 После мержа: `[futures-history] … request failed` по 龙虾USDT из
      терминала исчезает; вкладка истории/PnL наполняется сделками пары.
- [ ] 2.2 Строки истории по ASCII-парам не изменились (та же выборка, тот же
      порядок).
