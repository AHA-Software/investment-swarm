# Foundation

The [project plan](docs/PLAN.md) defines the intended product. This document
records the implementation boundaries that should survive refactors. Use the
[README](README.md) for setup and [AGENTS.md](AGENTS.md) for coding guidance.

## Purpose and ownership

Build an evidence-driven weather research system before considering a live
trading system. Agents can investigate and recommend. Deterministic code owns
the budget, state transitions and execution decisions. Current execution is
paper-only; there is no live submission implementation.

## Data invariants

- Record publication and receipt time. Validate timestamps and compare instants,
  not timestamp strings; offset representations must have identical semantics.
- Each weather event binds a city, station, date, settlement source and rule
  snapshot. Sources are not interchangeable. Labels need the appropriate
  forecast vintage and must have been available at the decision time.
- A partial intraday forecast is not a complete daily forecast. The first model
  is restricted to day-ahead evidence; intraday nowcasting is later work.
- Synthetic fixtures use a separate database and cannot qualify a strategy.
- Raw records and normalized snapshots are retained for replay and inspection.

## Financial invariants

- Money is stored in integer microdollars. Prices and quantities are parsed from
  fixed-point strings; v1 submits only simulated whole-contract quantities.
- One locked database transaction checks exposure and applies paper fills.
  Agent intent IDs are idempotent. All event buckets share the event allocation.
- The fixed policy is $100 capital, $5 per event, $25 total committed entry cost,
  $5 daily loss pause, $20 cumulative loss halt, and a 20% position loss trigger.
- Missing or stale liquidity contributes zero liquidation value. Authoritative
  settled payouts are valued correctly before testing loss thresholds.
- Exits remain pending until actual simulated fills or settlement resolve them.
  Partial fills reduce quantity and allocate entry cost proportionally.
- Pauses latch across date changes. Resume is a manual command that rechecks
  limits; it cannot reset the original bankroll or loss baseline to bypass them.

## Component boundaries

Kalshi MCP is a public read-only research connection. REST collects broader
market/depth data. Authenticated WebSockets optionally collect read-only updates.
The paper engine does not depend on an LLM being available. Research agents have
no shell/file tools, trade execution, strategy-approval tools or access to private
key contents. The dashboard binds to loopback and has no mutation endpoints.

Strategy changes are versioned and manually approved for paper use. Numerical
station calibration may update from newly settled past samples under the same
fixed algorithm; changing that algorithm is a separate reviewed strategy change.
Statistical reports cannot enable live execution.

## Stages

Collection and paper behavior come first, then prospective evaluation and
reviewed improvements. Live support is a future, separately authorized stage
with qualification and operational requirements defined in the plan. A passing
unit suite, a convincing demo or an isolated profitable period is not live
qualification.
