# Investment Swarm

Use Node 24+ and npm. Run `npm run check` after material changes.

This is a paper-only research system. Do not add live order submission, deposits,
withdrawals, or automatic strategy promotion as incidental changes. Risk limits
belong to deterministic code; model output must never bypass them. Preserve
publication and receipt timestamps and reject future information in replay.

Default pilot policy: $100 capital, $5 per city/date event, $25 total committed,
$5 daily loss pause, $20 cumulative loss halt, 20% position stop. A stop is an
attempt to exit, not a guaranteed sale. Missing bids mean zero liquidation value.

Research uses the official Kalshi MCP connector. Streaming and historical
collection use REST/WebSockets. The MCP connector cannot submit or cancel orders.
Do not expose private keys or unrestricted shell tools to the research agents.
