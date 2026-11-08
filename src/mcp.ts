import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const MCP_URL='https://api.elections.kalshi.com/mcp';
export const PUBLIC_TOOLS=['search_markets','get_event_odds','get_market','get_market_orderbook','get_market_links'] as const;
export async function withKalshiMcp<T>(fn:(client:Client)=>Promise<T>) {
  const client=new Client({name:'investment-swarm',version:'0.1.0'});
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
    return await fn(client);
  } finally { await client.close(); }
}
export async function mcpTools() { return withKalshiMcp(async c=>(await c.listTools()).tools.filter(t=>(PUBLIC_TOOLS as readonly string[]).includes(t.name))); }
export async function mcpRead(name:string,args:Record<string,unknown>) {
  if (!(PUBLIC_TOOLS as readonly string[]).includes(name)) throw new Error('Only allowlisted public, read-only Kalshi MCP tools are enabled');
  return withKalshiMcp(c=>c.callTool({name,arguments:args}));
}
