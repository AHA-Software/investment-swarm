import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CITIES, USD, iso, type City, type Market, type Book, type Level } from './domain.js';
import { parsePrice } from './math.js';

export const marketSchema = z.object({ ticker: z.string(), event_ticker: z.string(), title: z.string(), close_time: z.string().datetime(), status: z.string(), rules_primary: z.string(), rules_secondary: z.string().default(''), strike_type: z.string(), floor_strike: z.number().nullable().optional(), cap_strike: z.number().nullable().optional(), result: z.string().optional(), expiration_value: z.string().optional() }).passthrough();
const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
export function eventDate(event: string) {
  const m = /-(\d{2})([A-Z]{3})(\d{2})$/.exec(event);
  if (!m || !months.includes(m[2]!)) throw new Error('Unrecognized weather event date');
  const date = `20${m[1]}-${String(months.indexOf(m[2]!) + 1).padStart(2, '0')}-${m[3]}`;
  if (new Date(date).toISOString().slice(0,10) !== date) throw new Error('Invalid event date');
  return date;
}
export function normalizeMarket(raw: unknown, city: City, feeRate: number | null): Market {
  const m = marketSchema.parse(raw), config = CITIES[city];
  let lower: number | null = null, upper: number | null = null, boundsKnown = true;
  if (m.strike_type === 'greater' && typeof m.floor_strike === 'number') lower = Math.floor(m.floor_strike) + 1;
  else if (m.strike_type === 'less' && typeof m.cap_strike === 'number') upper = Math.ceil(m.cap_strike) - 1;
  else if (m.strike_type === 'between' && typeof m.floor_strike === 'number' && typeof m.cap_strike === 'number') { lower = Math.ceil(m.floor_strike); upper = Math.floor(m.cap_strike); }
  else boundsKnown = false;
  const rules = `${m.rules_primary}\n${m.rules_secondary}`;
  const source = /according to The Weather Company/i.test(m.rules_primary) ? 'The Weather Company' : /according to (?:the )?(?:National Weather Service|NWS)/i.test(m.rules_primary) ? 'NWS' : 'unknown';
  const station = /\((CLI[A-Z]+)\)/.exec(m.rules_primary)?.[1] ?? 'unknown';
  return { ticker: m.ticker, event: m.event_ticker, city, date: eventDate(m.event_ticker), title: m.title, closeAt: m.close_time, status: m.status, rules, rulesHash: createHash('sha256').update(rules).digest('hex'), source, station, lower, upper, feeRate,
    rulesVerified: boundsKnown && source !== 'unknown' && station === config.climateStation && m.ticker.startsWith(`${config.series}-`) && /maximum temperature/i.test(m.rules_primary) && (lower === null || upper === null || lower <= upper),
    ...(m.result === 'yes' || m.result === 'no' ? { result: m.result } : {}), expirationValue: m.expiration_value,
  };
}
const fpLevel = z.tuple([z.string(), z.string()]);
export function normalizeLevels(input: unknown): Level[] {
  return z.array(fpLevel).parse(input).map(([price, quantity]) => {
    const n = Number(quantity);
    if (!Number.isFinite(n) || n < 0) throw new Error('Invalid order-book quantity');
    return { price: parsePrice(price), quantity: n };
  }).filter(l => l.quantity > 0).sort((a,b) => b.price-a.price);
}
export function normalizeBook(ticker: string, raw: unknown, receivedAt = iso()): Book {
  const parsed = z.object({ orderbook_fp: z.object({ yes_dollars: z.array(fpLevel).nullable(), no_dollars: z.array(fpLevel).nullable() }) }).parse(raw);
  const yes = normalizeLevels(parsed.orderbook_fp.yes_dollars ?? []), no = normalizeLevels(parsed.orderbook_fp.no_dollars ?? []);
  return { ticker, receivedAt, yes, no, source: 'rest', valid: (yes[0]?.price ?? 0) + (no[0]?.price ?? 0) < USD };
}
export async function getJson(url: string, userAgent = process.env.USER_AGENT ?? 'investment-swarm/0.1 (local research)'): Promise<unknown> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { 'User-Agent': userAgent, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(r => setTimeout(r, 300 * 2 ** attempt)); continue; }
    if (!response.ok) throw new Error(`GET ${new URL(url).hostname}${new URL(url).pathname}: HTTP ${response.status}`);
    return response.json();
  }
  throw new Error('Request retries exhausted');
}
export class KalshiData {
  private nextRequestAt = 0;
  constructor(private base = 'https://external-api.kalshi.com/trade-api/v2') {}
  async get(path: string) {
    if (!path.startsWith('/') || path.includes('..') || path.startsWith('//')) throw new Error('Invalid API path');
    const wait = Math.max(0, this.nextRequestAt - Date.now());
    this.nextRequestAt = Math.max(Date.now(), this.nextRequestAt) + 120;
    if (wait) await new Promise(r => setTimeout(r, wait));
    return getJson(this.base + path);
  }
  async markets(city: City, status = 'open') {
    const all: unknown[] = []; let cursor = '';
    do {
      const params = new URLSearchParams({ series_ticker: CITIES[city].series, status, limit: '200', ...(cursor ? { cursor } : {}) });
      const r = z.object({ markets: z.array(z.unknown()), cursor: z.string().optional() }).parse(await this.get(`/markets?${params}`));
      all.push(...r.markets); cursor = r.cursor ?? '';
      if (all.length > 5000) throw new Error('Market pagination exceeded safety bound');
    } while (cursor);
    return all;
  }
  async feeRate(city: City): Promise<number | null> {
    const r = z.object({ series: z.object({ fee_type: z.string(), fee_multiplier: z.number() }) }).parse(await this.get(`/series/${CITIES[city].series}`));
    // v1 only supports the ordinary quadratic taker schedule. Unknown models fail closed.
    return r.series.fee_type === 'quadratic' ? 0.07 * r.series.fee_multiplier : null;
  }
  async book(ticker: string) { return normalizeBook(ticker, await this.get(`/markets/${encodeURIComponent(ticker)}/orderbook?depth=100`)); }
  async market(ticker: string, city: City, feeRate: number | null) {
    const r = z.object({ market: z.unknown() }).parse(await this.get(`/markets/${encodeURIComponent(ticker)}`));
    return normalizeMarket(r.market, city, feeRate);
  }
}
