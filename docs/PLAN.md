# Kalshi weather agent swarm — implementation plan

Agreed November 8, 2026. This plan records the product decisions from the project
chat, including the subsequent decision to use Kalshi's official MCP connector.
It is the source of scope and milestones. The [README](../README.md) describes
the current implementation; [FOUNDATION](../FOUNDATION.md) records its invariants.

## Goal

Recognize potentially useful patterns in Kalshi weather data, select and abandon
positions autonomously inside fixed limits, and improve strategies using measured
results and human-reviewed updates. Establish an advantage after fees, spread,
and realistic execution before considering real money.

Start with a local paper prototype for daily high-temperature contracts in NYC,
Chicago, and Miami. Exclude hourly markets, other asset categories, margin and
leverage. A later live pilot has a maximum funded bankroll of $100; it requires
qualification, an always-on host, and explicit human launch approval. Building
the prototype does not authorize live trading.

## Architecture

- Research agents: data quality, forecasts, patterns, critique, portfolio ranking,
  and evaluation. Numerical models supply probabilities; LLMs supply research
  and explanations.
- Official Kalshi MCP: market discovery, rules, prices and limited order-book
  inspection. Optional future OAuth portfolio reads are separate from execution.
- REST/WebSocket collectors: continuous market data, historical retrieval,
  timestamped weather forecasts and observations, fills and market state.
- Shared storage: PostgreSQL records data provenance, decisions, strategy
  versions and audit history. Embedded PostgreSQL supports local development.
- Deterministic risk controller: owns shared capital and blocks conflicting or
  excessive orders. A single execution authority owns execution credentials.
- Paper adapter: simulates bounded orders, conservative fees, partial fills,
  unavailable liquidity and settlement. A future live adapter is a separate
  milestone and absent from the initial release.

Kalshi's official MCP cannot place or cancel orders. It complements rather than
replaces the data collector and execution service.

## Policy selected by Roger

| Control | Value |
| --- | ---: |
| Pilot bankroll | $100 |
| Maximum entry cost per city/date weather event | $5 |
| Maximum total committed entry cost | $25 |
| Daily loss pause | $5 |
| Cumulative pilot loss halt | $20 |
| Position loss exit trigger | 20% below entry cost |
| Initial minimum modeled net advantage | 5 cents/contract |

Entry cost includes fees. Buckets for the same weather event share the event
limit. Loss accounting includes realized PnL and conservative executable
liquidation value. Use Los Angeles calendar days for daily accounting. Pauses
and halts latch; an agent cannot reset or replenish the bankroll.

Attempt an exit when net executable proceeds fall to 80% of allocated entry
cost or when updated expected settlement value falls below available net sale
proceeds. A stop is an attempt, not a guaranteed sale or maximum loss. Retain
unfilled positions as exit-pending, prevent event re-entry and continue monitoring.

## Data and modeling

Use the exact contract station, ranges, statistical period, rounding, closing
time and named settlement source. Do not treat NWS predictions or observations
as a substitute for a contract that settles on The Weather Company.

Archive publication and receipt times. Historical replay may only see data
available at its decision time. If a historical forecast vintage is unavailable,
collect prospectively instead of reconstructing it using a revised forecast.
Bind labels to source, station, event date and forecast horizon. Keep fixtures
out of real evaluation and training.

Initial strategy: station-specific forecast-error distributions with coherent
temperature-range probabilities. Require 30 settled day-ahead samples per
station. Require valid and fresh evidence, executable depth, supported fees and
an independently recomputed advantage before any entry. Momentum and order-book
imbalance are hypotheses until separately validated.

## Implementation stages and acceptance

1. **Data and baseline.** Collect and normalize inputs; expose readiness and
   provenance. Reproduce each decision from saved inputs.
2. **Paper execution.** Implement the shared risk budget and realistic exits.
   Prove atomic competing intents, duplicate idempotency, bucket aggregation,
   partial/unfilled exits, loss latches and restart recovery. Use demo APIs for
   integration behavior, not proof of trading performance.
3. **Evaluation and improvements.** Evaluate chronologically; record calibration,
   Brier score, fees, net PnL, drawdown, turnover and failed exits. Test challengers
   on unseen later data. Keep the active strategy rule set fixed during its
   prospective evaluation. Algorithm changes require human review and a distinct
   version; retain prior versions and their evidence.
4. **Live qualification — future work.** Require at least 60 forward-paper days,
   100 completed event trades, positive net results, a positive lower 95%
   date-block-resampled bound on mean daily PnL, improved Brier score versus the
   market, no unresolved risk/reconciliation failures, operational recovery
   exercises, operating-cost accounting, an always-on host and human approval.

The sample minimum alone is insufficient. Remaining in paper indefinitely is
acceptable if no durable advantage is demonstrated. Switching strategies cannot
combine their evaluation histories to pass qualification.

## Non-goals and defaults

No paid weather feeds initially. Report operating costs separately from trading
capital. Account creation, deposits and withdrawals remain manual. No automatic
live strategy promotion or risk-policy changes. The local release must contain
no live order submission path.

## Official references

- [Kalshi MCP capabilities](https://docs.kalshi.com/getting_started/mcp)
- [Kalshi historical data](https://docs.kalshi.com/getting_started/historical_data)
- [Kalshi WebSockets](https://docs.kalshi.com/getting_started/quick_start_websockets)
- [Kalshi fee rounding](https://docs.kalshi.com/getting_started/fee_rounding)
- [NWS API](https://www.weather.gov/documentation/services-web-api)
