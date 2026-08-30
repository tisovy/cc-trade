# Tasks

## 0. Measured first, 2026-08-29

- Слово оператора: торговля на 龙虾USDT живая (9 placements + 2 cancels в
  журнале, все ответы `ok`, 2 позиции), «всё работает нормально».
- Аудит всех оставшихся символьных паттернов деска: четыре ASCII-затвора за
  исполнением — income-канонизация (строка выбрасывается молча,
  `canonicalFuturesIncomeRows` пропускает null без ошибки), reverse-flat
  (`INCOMPLETE_SUFFIX` до чтения строк), coverage в `account.history`
  (запись пары отброшена — перечитывание с нуля), book-view store (настройки
  книги пары не запоминаются). Канон сам требовал ASCII в требовании
  «Settled-income publication follows canonical content».

## 1. Implementation

- [x] 1.1 `CANONICAL_SYMBOL_TEXT` → алфавит идентичности биржи
      (`[\p{Lu}\p{Lt}\p{Lo}\p{N}_]`, флаг `u`); типы и активы остаются ASCII;
      `boundedUpperText` по-прежнему не триммит и не апперкейсит — кейс-фолд
      защиты (ſ, ı, ﬁ, lowercase, padded) держатся прежними тестами.
- [x] 1.2 `futures-trade-history-reverse-flat` и coverage в
      `trading-command-validation` переведены на
      `normalizeFuturesTradeHistorySymbol` — одно правило написания с самой
      админкой evidence; семантика trim+uppercase сохранена (пинуется
      существующим тестом `btcusdt` → `BTCUSDT`).
- [x] 1.3 `futuresBookView` `SYMBOL_PATTERN` → тот же алфавит.
- [x] 1.4 Устаревшие заявления «deliberately ASCII execution path» в
      комментариях (`futuresTradeHistoryEvidence`, `futuresReadiness`)
      переписаны честно: деск торгует всё каталогизированное, гейт LISTING —
      страж расхождения.
- [x] 1.5 Четыре новых теста укушены против кода до правки (git archive →
      scratch: 4 failed / 121 passed), полный прогон 128/2965 зелёный, линт,
      все четыре стража.

## 2. Operator verification (runbook, live)

- [x] 2.1 После ближайшего фандинг-часа по 龙虾USDT: заряд виден в settled
      (PnL-док), сумма бьётся с бинанс-аппом. Подтверждено оператором
      2026-08-30 («да все ок») после дня торговли парой (515 кадров, команды,
      позиции в журнале) через три границы фандинга; журнал держит пары
      `funding` → `confirm` на каждой границе. Ledger, The 2026-08-30
      Operator Sitting.
- [x] 2.2 Закрытые раунды пары в истории якорятся (нет вечного «reading»),
      повторное открытие вкладки не перечитывает пару с нуля. Тот же ответ
      оператора, 2026-08-30.
- [x] 2.3 Настройка группировки книги на 龙虾USDT переживает рестарт деска.
      Тот же ответ оператора, 2026-08-30; рестарты деска в этот день в
      журнале есть (18:47:24Z).
