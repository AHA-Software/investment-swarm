import { defineMcpClientConnection } from 'eve/connections';
export default defineMcpClientConnection({
  url: 'https://api.elections.kalshi.com/mcp',
  description: 'Official Kalshi public research: discover weather markets and read exact rules, prices and order-book snapshots. This connection cannot execute trades.',
  tools: { allow: ['search_markets','get_event_odds','get_market','get_market_orderbook','get_market_links'] },
});
