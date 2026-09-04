## Context

`@binance/common` 2.0.1 maps HTTP 400 to `BadRequestError` without an exchange code, and no-response failures to `NetworkError` without a transport code. Its GET/DELETE retries can hide physical attempts. The shared SDK REST object also serves public-market reads outside SpotTradingAdapter.

## Decisions

1. Install one protected facade on the shared `client.restAPI`. Configure its existing Axios options to accept HTTP responses and set SDK retries to zero. The facade checks every REST method's returned response before exposing it, so public reads cannot accidentally consume an error body as market data. Keep SDK signing, agents, headers, big-integer parser, and endpoint composition.
2. A local `SpotRestError` carries status, numeric exchangeCode (also code for existing consumers), transport classification, and outcome certainty. It contains no request config, headers, URL, credentials, or raw body. The SDK's network error remains explicitly unknown: reconstructing ECONNREFUSED versus a reset after acceptance would be guessing. No message matching to infer -2013.
3. Parse a response once, validate its status/error body, then preserve the SDK response interface and metadata with a cached `data()` result. Malformed or absent responses are unknown rather than fabricated acceptance; HTTP 5xx and Binance -1000/-1006/-1007 are unknown. A well-formed 4xx business refusal stays determinate. Only an explicit determinate -2013 lookup establishes absence.
4. Do not add process-wide Axios interceptors, monkey-patch dependencies, or replace the exchange client. A per-instance facade confines the change to this desk's Spot REST leg and avoids a global credential-bearing error channel. Local parameter validation errors before an SDK response remain ordinary failures.
5. No hidden retries, including GET: existing read owners retain their bounded retry budgets. Mutations are sent once, then resolved by read-only reconciliation. This reduces physical request amplification; there is no new automatic mutation replay.

## Risks and verification

Graph LOW is incomplete for SDK dispatch and nested callbacks. Text search confirms direct public REST consumers and Spot command handlers. Real installed SDK tests must cover valid signing/identity, 4xx -2013 and rejection, 5xx, unknown execution codes, malformed JSON, network reset/timeout, and one physical attempt for POST/DELETE/GET. Service tests must demonstrate unresolved-to-resolved reconciliation and no second mutation. Full test/lint/build and graph diff precede commit.

## Acceptance boundary

No live orders or trading-session launch. Operator confirmation is still required before archive. Existing action-specific cancel/modify reconciliation (F06) is not claimed fixed by an improved transport boundary.
