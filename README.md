# Investment Swarm

A local, **paper-only** Kalshi weather research system. It collects daily
high-temperature markets for New York, Chicago and Miami, estimates forecast
probabilities, and simulates trades behind shared deterministic risk limits.

The [project plan](docs/PLAN.md) records the agreed scope, architecture,
milestones and qualification criteria. [FOUNDATION.md](FOUNDATION.md) explains
the invariants; [AGENTS.md](AGENTS.md) guides code changes.

## Current implementation

| Implemented | Still planned / not enabled |
| --- | --- |
| Official Kalshi public MCP connection and five Eve research specialists | Portfolio OAuth connection and model-backed research acceptance run |
| Public REST market, depth, forecast and observation collection | Comprehensive historical backfill and replay CLI |
| Optional authenticated WebSocket collector with sequence-gap recovery | Credentialed WebSocket/demo-exchange smoke checks |
| Day-ahead station forecast-error baseline and readiness checks | Intraday nowcasting, independently qualified price-pattern strategies |
| Atomic paper risk decisions, depth-limited fills, partial exits, settlement and audit history | More complete latency/market-impact simulation and external alert delivery |
| Loopback dashboard, Python evidence report, manual paper strategy proposals/approval | Automated challenger evaluation pipeline and operating-cost ingestion |
| Embedded PostgreSQL plus standard PostgreSQL support | Always-on deployment, qualification review and live adapter |

There is **no live order submission, cancellation, deposit or withdrawal path**.
Setting `TRADING_MODE=live` fails at startup. Research agents cannot change risk
limits or approve strategies. A statistical report cannot enable live trading.

## Requirements

- Node.js 24+ and npm
- Python 3.11+ through [uv](https://docs.astral.sh/uv/)
- Docker only if using the provided PostgreSQL service or building Eve's Docker
  research sandboxes
- Network access for collection and MCP; no account credentials for public data

```sh
cd /Users/rurich/Development/investment-swarm
npm ci
uv sync --project modeling
cp .env.example .env
```

The default database is embedded PostgreSQL under `data/paper`, so Docker is
optional. Run only one application process against an embedded database.

For standard PostgreSQL, start Docker and set this in `.env`:

```sh
docker compose up -d postgres
```

```dotenv
DATABASE_URL=postgresql://swarm:swarm@localhost:5432/swarm
```

The Compose password is for local development and the port binds to loopback.
PostgreSQL allows the collector, dashboard and commands to share a database.
`docker compose down` preserves the database volume; do not use `-v` unless you
intend to delete it.

## Try the isolated demo

```sh
npm run demo
npm run dev -- --demo
```

Open [the dashboard](http://127.0.0.1:4310). The demo creates one entry, fills part
of a stop-loss exit, then leaves the remainder pending when liquidity disappears.
Its database is `data/demo`; rerunning preserves the existing demo. Fixtures never
count toward real forward-paper evidence. The demo uses a fixed synthetic clock,
so its book is naturally stale when inspected at the current time.

Stop the dashboard with Ctrl-C before starting another process on the same port.

## Collect and run paper research

```sh
npm run collect          # one public-data collection pass
npm run paper            # continuous collection, paper engine and dashboard
```

The continuous runner independently discovers contracts every 10 minutes,
collects weather and settlements every 5 minutes, refreshes books continuously,
and monitors positions approximately once a second. Entries are considered at
most once a minute. Weather/API delays do not block the separate stop-monitoring
loop, but a failed or stale price feed can prevent execution. This is polling,
not a guaranteed fill service. Restarting keeps positions and loss latches in
the database.

Fresh installations will normally show **no trades**: the model requires 30
settled day-ahead forecast/outcome pairs for each station and the same settlement
source. Collection builds this history prospectively. It never invents old
forecasts or treats current observations as historical forecast vintages.

NWS weather is predictive input. Contract rules decide the settlement source;
the current daily series name The Weather Company. The initial strategy uses
complete day-ahead forecasts, not partial intraday forecasts or observations.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Read-only dashboard on `127.0.0.1:4310` |
| `npm run swarm -- status` | Portfolio, readiness, market and health snapshot |
| `npm run mcp:check` | List allowlisted official public research tools |
| `npm run swarm -- mcp get_market '{"market_ticker":"KXHIGHNY-26NOV09-T64"}'` | Inspect one named market; replace the example ticker as needed |
| `npm run swarm -- stream` | Read-only WebSocket collector; requires credentials |
| `npm run swarm -- report` | Python performance and statistical-gate report |
| `npm run swarm -- report --demo` | Evidence report for fixtures, which cannot qualify |
| `npm run swarm -- export` | JSON evaluation input for offline analysis |
| `npm run swarm -- pause` | Latch a manual pause and attempt paper exits |
| `npm run swarm -- resume` | Recheck loss limits and manually resume if permitted |
| `npm run swarm -- propose` | Create a paper candidate that raises the edge threshold to 6 cents |
| `npm run swarm -- approve <candidate-id>` | Manually select a reviewed candidate for paper use |
| `npm run agent:dev` | Optional interactive Eve research team |
| `npm run agent:build` | Build the research-agent application without model calls |

The proposal command is intentionally narrow. Its attached evidence describes
the current strategy, not proven candidate performance. A paper approval never
approves live trading. Reports separate the active strategy's fills and use its
approval date as the start of its prospective evaluation.

## Kalshi MCP and research agents

The [official connector](https://docs.kalshi.com/getting_started/mcp) is configured
in `agent/connections/kalshi.ts`; `.mcp.json` provides a remote-connector definition
for compatible clients. The application's MCP client and Eve connection allow
only public search, event odds, market rules, order books and market links.

MCP does not execute orders or provide the full historical/streaming feed. The
collector uses REST/WebSockets; the deterministic engine simulates execution.

Eve has data, forecast, pattern, critic and evaluator specialists. Default shell
and file tools are disabled. Agents can read the local dashboard and public MCP
data. Configure model access with an AI Gateway key and optionally
`SWARM_RESEARCH_MODEL`; no model credentials are needed for the collector or paper
engine. Starting model-backed research can incur model costs. No model-backed
turn has been run as part of setup. A weekly review schedule is defined for a
built Eve application, but `eve dev` does not run it on cadence.

## Configuration

| Variable | Default / meaning |
| --- | --- |
| `TRADING_MODE` | `paper`; other values are rejected |
| `DATABASE_URL` | Unset uses embedded PostgreSQL; set for standard PostgreSQL |
| `DATA_DIR` | `./data/paper` for the embedded database |
| `PORT` | `4310` for the loopback dashboard |
| `USER_AGENT` | Request identifier for NWS and Kalshi public collection |
| `KALSHI_API_KEY_ID` | Optional authenticated market-stream key ID |
| `KALSHI_PRIVATE_KEY_PATH` | Path to signing key for the read-only stream; never key contents |
| `AI_GATEWAY_API_KEY` | Optional model access for Eve research |
| `SWARM_RESEARCH_MODEL` | Optional Gateway model ID |
| `TEST_DATABASE_URL` | Disposable PostgreSQL integration-test parent connection |

Keep `.env`, keys, local databases and generated build output out of Git. The
dashboard is read-only and binds to loopback. Do not expose it publicly as-is.

## Risk policy and accounting

The immutable initial policy is $100 capital, $5 per event, $25 total committed
entry cost, a $5 daily loss pause, a $20 cumulative loss halt, a 20% position loss
exit trigger and a 5-cent modeled advantage after estimated trading costs.
Money is stored in integer microdollars; the prototype uses whole contracts.

Missing/stale bids value unresolved positions at zero. Official settled outcomes
are valued at their known payout. Fees are modeled conservatively by rounding
each consumed level up to one cent without exchange rounding rebates. Supported
quadratic series/event fee overrides are read from Kalshi; unknown fee types
block entries. Entries also need enough quoted exit depth and must not already
cross the loss trigger after spread and fees. This is not a complete reproduction
of exchange fee accumulation.

Stops remain attempts: fills depend on available depth, partial fills leave a
latched exit, and empty books do not close positions. A 20% trigger cannot bound
actual losses. Pauses persist across midnight. Manual resume cannot reset the
bankroll or resume while the applicable loss threshold remains breached.

## Verification

```sh
npm run check
TEST_DATABASE_URL=postgresql://swarm:swarm@localhost:5432/swarm npm test
npm run agent:build
npm run demo
npm run mcp:check
npm run collect
```

`npm run check` runs TypeScript, deterministic/storage/stream tests, and Python
evaluation tests. The PostgreSQL test is skipped unless `TEST_DATABASE_URL` is
provided; it creates a uniquely named scratch database, competes through separate
connection pools, then drops only that scratch database. Its user needs permission
to create databases. Tests never submit exchange orders.

See [docs/VERIFICATION.md](docs/VERIFICATION.md) for observed checks and limitations.
Passing tests and successful public connections establish prototype behavior;
they do not establish profitability or live readiness.

## Next milestones

Continue prospective collection; verify real settlement-derived labels and
forecast vintages over actual event lifecycles. Add comprehensive replay,
candidate-specific forward evaluation, latency/impact stress tests, operating-cost
ingestion, external alerts and recovery exercises. These precede the live
qualification review described in the [plan](docs/PLAN.md). Live support remains
a future, separately reviewed milestone.
