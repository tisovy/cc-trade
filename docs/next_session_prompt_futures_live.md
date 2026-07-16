# Prompt for the next Futures Live session

Скопируй следующий блок в новую сессию:

```text
Работаем в /home/me/work/trade_ui_latest. Вывод Futures Testnet из runtime и
ускорение Futures Live уже закоммичены в текущей ветке. Сначала проверь
`git status` и последние commit'ы, не откатывай завершённую работу, затем
прочитай AGENTS.md и:

- docs/futures_live_performance_and_testnet_retirement_plan.md
- archive/futures-testnet/README.md
- archive/futures-testnet/MANIFEST.md
- docs/futures_phase7_live_operator_runbook.md

Работай последовательно в четырёх ролях:

1. Lead React/Electron architect — проверь границы renderer/main process,
   lifecycle hooks, generation ownership и отсутствие Testnet в активной сборке.
   Vue рассматривай только как сравнительную экспертизу; этот репозиторий React.
2. Performance engineer — оцени cold/warm Futures Live по безопасным timing-логам
   exchange-info, upstream-streams, шести bootstrap resources и aggregate-ready.
   Отделяй реальную метрику от теоретической оценки. Не выполняй реальный
   Binance network smoke без отдельного явного разрешения пользователя.
3. Trading-safety/security reviewer — докажи, что market-data cache не попал в
   execution/risk path, Testnet/legacy frames fail closed, а production gates,
   caps, intent, kill switch, ledger и recovery не ослаблены.
4. QA/release verifier — проверь unit, lint, circular/boundary gates, production
   build, E2E build и Electron Playwright. Не размещай ордера и не печатай
   credentials. Не коммить без прямой просьбы.

Обязательный workflow GitNexus:

- для незнакомого потока используй query/context;
- перед изменением каждого существующего symbol запускай upstream impact и
  сообщай blast radius; при HIGH/CRITICAL остановись и предупреди до правки;
- после любых правок запусти detect_changes(scope="compare", base_ref="main")
  и сопоставь каждый затронутый flow с ожидаемым scope.

Текущий реализованный контракт:

- selector содержит только Spot и Futures Live;
- legacy FUTURES_TESTNET_* / FUTURES_READ_* scrubbed, старые протоколы
  отвергаются до общего JSON/Spot routing;
- Testnet-код удалён из активных src/electron/tests и восстанавливается только
  из Git SHA, указанного в archive manifest;
- exchangeInfo имеет main-process cache TTL 5 минут, in-flight deduplication и
  no-stale-on-error;
- шесть независимых REST bootstrap reads идут с maximum concurrency 3;
- timing records содержат только phase, durationMs, outcome, cache;
- catalog chunks coalesced до одного renderer state update;
- interval switch не отправляет промежуточный unsubscribe, сохраняет
  same-symbol widgets как stale и не remount-ит workstation view;
- resource-level LIVE может отображаться при aggregate loading/resync.

Сначала сделай review существующего diff и текущих результатов проверок. Если
ошибок нет, не переписывай архитектуру ради стиля. Основной следующий кандидат
на оптимизацию — отдельный interval-only market-stream/bootstrap путь, чтобы не
переснимать depth/ticker при смене таймфрейма; это требует нового impact review
и не должно делаться без доказательства, что split-stream lifecycle сохраняет
depth sequencing и generation safety.

Финальный отчёт дай по-русски: найденные проблемы по severity, фактические
метрики cold/warm (или явно скажи, что live benchmark не выполнялся), результаты
проверок, GitNexus affected flows и безопасный следующий шаг.
```
