# Verification record

Observed locally on November 8, 2026. These checks verify prototype behavior,
not profitability, financial suitability, or readiness for live trading.

## Automated checks

| Check | Observed result |
| --- | --- |
| `TEST_DATABASE_URL=postgresql://swarm:swarm@localhost:5432/swarm npm run check` | Passed: TypeScript typecheck, 36 Vitest tests, six Python tests |
| PostgreSQL contention | Passed against Docker PostgreSQL 17, using independent pools and a uniquely named scratch database |
| `npm run agent:build` | Passed; root plus five research specialists compiled; no model calls |
| `git diff --check` | Passed before committing the completed chunks |

Without `TEST_DATABASE_URL`, the real PostgreSQL test is skipped explicitly;
the embedded-storage tests still run. The integration test creates and removes
only its scratch database. Database shutdown waits for connections to close;
cleanup does not forcibly terminate application sessions.

Coverage includes simultaneous competing intents, duplicate intent idempotency,
aggregate city/date exposure even with different event identifiers, global
commitment caps, independent probability checks, loss-limit latches and day
boundaries, unknown/stale/absent liquidity, partial exits, repeated use of the
same liquidity snapshot, successful and losing settlement, transaction rollback,
malformed timestamps, equivalent/future timezone offsets, source/station/vintage
binding, fixture isolation, sequence gaps, dashboard read-only behavior, and
monitoring independence from blocked weather collection.

The fresh in-memory demo regression verifies an entry, one partial exit, and an
unfilled exit remainder. It retains a position and records `exit_pending`; it
does not treat the stop trigger as a complete sale.

## Public integration smoke checks

- `npm run collect`: retrieved 36 contracts and 36 order books; forecasts and
  observations succeeded for all three configured stations; reported no errors.
- `npm run mcp:check`: connected to the official hosted connector and listed
  the five allowlisted public research tools.
- `npm run swarm -- mcp get_market '{"market_ticker":"KXHIGHNY-26NOV09-T64"}'`:
  returned market status, current quotes, and the exact Weather Company rules.
- `npm run demo`: created the isolated synthetic paper lifecycle. Subsequent
  invocations preserved that database instead of resetting it.
- `npm run swarm -- report`: returned zero settled forward events and failed
  the statistical qualification gates, with `liveEnabled: false`.
- `npm run swarm -- report --demo`: explicitly reported fixture data and failed
  the real-forward-data gate, with `liveEnabled: false`.

These are network smoke checks against data available on the date above;
availability and market counts can change.

## Local runtime and browser checks

Docker PostgreSQL was healthy. The continuous paper runner was started, stopped
and restarted against the same database. It retained $100 paper cash, no open
positions, and abstained because each station had zero eligible settled training
samples. Public collection continued independently of the engine loop.

Playwright opened the real local dashboard and inspected desktop and 390×844
mobile layouts. The dashboard showed paper-only status, readiness, exposure,
decision history and feed health. Screenshots are local ignored artifacts under
`output/playwright/`. The HTTP regression additionally verifies mutation
requests are rejected and `.env` is not served.

## Not run / not established

- No authenticated WebSocket connection: requires a user-provided key ID and
  signing-key path. Signing and stream reconciliation have unit coverage only.
- No authenticated Kalshi demo-exchange order lifecycle or portfolio OAuth.
- No model-backed Eve turn: no model credential was configured or used. Research
  agent compilation is verified; model behavior remains an acceptance task.
- No real settled forecast/outcome label lifecycle has completed during setup.
- No 60-day forward trial, 100-event sample, profitable edge, operating-cost
  accounting, long-running outage exercise, or live qualification.
- No live order execution, funds movement, deployment, or Git push.

See the [plan](PLAN.md) for the remaining milestones and [README](../README.md)
for commands and limitations.
