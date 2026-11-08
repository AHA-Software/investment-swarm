import { z } from 'zod';

// Monetary values use integer microdollars. Never persist binary floating-point dollars.
export const USD = 1_000_000;
export const dollar = (n: number) => Math.round(n * USD);
export const dollars = (n: number) => n / USD;
export const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(dollars(n));
export const POLICY = Object.freeze({ bankroll: dollar(100), eventCap: dollar(5), totalCap: dollar(25), dailyLoss: dollar(5), cumulativeLoss: dollar(20), stopRatio: 0.8, minimumEdge: 0.05, bookMaxAgeMs: 10_000, forecastMaxAgeMs: 12 * 3_600_000, forecastPollMaxAgeMs: 15 * 60_000, minSamples: 30 });

export type City = 'nyc' | 'chicago' | 'miami';
export const CITIES: Record<City, { name: string; series: string; station: string; climateStation: string; lat: number; lon: number; timezone: string }> = {
  nyc: { name: 'New York', series: 'KXHIGHNY', station: 'KNYC', climateStation: 'CLINYC', lat: 40.7789, lon: -73.9692, timezone: 'America/New_York' },
  chicago: { name: 'Chicago', series: 'KXHIGHCHI', station: 'KMDW', climateStation: 'CLIMDW', lat: 41.7868, lon: -87.7522, timezone: 'America/Chicago' },
  miami: { name: 'Miami', series: 'KXHIGHMIA', station: 'KMIA', climateStation: 'CLIMIA', lat: 25.7906, lon: -80.3164, timezone: 'America/New_York' },
};
export const iso = () => new Date().toISOString();
export const timestampSchema = z.string().datetime({ offset: true }).refine(v => Number.isFinite(Date.parse(v)), 'Invalid timestamp');
export function validTime(value: string) { return timestampSchema.safeParse(value).success; }
export const epoch = (value: string) => Date.parse(timestampSchema.parse(value));
export function priorDate(date:string) { const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10); }
export function weatherEvent(city: City, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new Error('Invalid weather date');
  const d=new Date(date+'T12:00:00Z'),months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${CITIES[city].series}-${String(d.getUTCFullYear()).slice(-2)}${months[d.getUTCMonth()]}${String(d.getUTCDate()).padStart(2,'0')}`;
}
export function localDate(timestamp: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(timestamp));
  const val = (type: string) => parts.find(p => p.type === type)!.value;
  return `${val('year')}-${val('month')}-${val('day')}`;
}
export const sideSchema = z.enum(['yes', 'no']);
export type Side = z.infer<typeof sideSchema>;
export type Level = { price: number; quantity: number };
export interface Book { ticker: string; receivedAt: string; yes: Level[]; no: Level[]; source: 'rest' | 'websocket' | 'fixture'; valid: boolean }
export interface Market {
  ticker: string; event: string; city: City; date: string; title: string; closeAt: string;
  status: string; rules: string; rulesHash: string; source: string; station: string;
  lower: number | null; upper: number | null; rulesVerified: boolean;
  feeRate: number | null; result?: Side; expirationValue?: string;
}
export interface Forecast { city: City; date: string; highF: number; publishedAt: string; receivedAt: string; periods: number; complete: boolean }
export interface TrainingSample { city: City; date: string; station: string; event: string; forecastHigh: number; observedHigh: number; forecastPublishedAt: string; forecastReceivedAt: string; settledAt: string; source: string; rulesHash: string; horizon: 'day-ahead'; fixture?: boolean }
export interface Estimate { ticker: string; probability: number; sigma: number; bias: number; samples: number; modelVersion: string; availableAt: string; trainedThrough: string | null }
export const intentSchema = z.object({
  id: z.string().uuid(), ticker: z.string(), event: z.string(), side: sideSchema,
  quantity: z.number().int().positive().max(1000), limitPrice: z.number().int().min(1).max(USD - 1),
  probability: z.number().min(0).max(1), strategyVersion: z.string(),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(), rationale: z.string(), rulesHash: z.string(),
});
export type TradeIntent = z.infer<typeof intentSchema>;
export interface Position {
  id: string; ticker: string; event: string; side: Side; quantity: number;
  cost: number; openedAt: string; strategyVersion: string; exitReason?: string;
}
export interface Fill { id: string; intentId: string; ticker: string; side: Side; action: 'buy' | 'sell' | 'settle'; quantity: number; price: number; fee: number; timestamp: string; realizedPnl: number; strategyVersion: string }
export interface Decision { id: string; timestamp: string; ticker: string; agent: string; action: string; reasons: string[]; intent?: TradeIntent; estimate?: Estimate }
export interface Strategy { id: string; status: 'candidate' | 'approved' | 'retired'; createdAt: string; approvedAt?: string; notes: string; parameters: { minimumEdge: number }; evidence?: Record<string, unknown> }
export interface State {
  version: 1; mode: 'paper'; fixture: boolean; startedAt: string; cash: number;
  day: string; dayStartEquity: number; paused: boolean; halted: boolean; pauseReason: string | null;
  positions: Position[]; fills: Fill[]; decisions: Decision[]; processedIntents: string[];
  eventLocks: string[]; strategies: Strategy[]; activeStrategy: string;
  equityHistory: { timestamp: string; equity: number; day: string }[];
  usedLiquidity: Record<string, { receivedAt: string; yes: Record<string,number>; no: Record<string,number> }>;
}
export function initialState(now = iso(), fixture = false): State {
  return { version: 1, mode: 'paper', fixture, startedAt: now, cash: POLICY.bankroll,
    day: localDate(now, 'America/Los_Angeles'), dayStartEquity: POLICY.bankroll,
    paused: false, halted: false, pauseReason: null, positions: [], fills: [], decisions: [],
    processedIntents: [], eventLocks: [], strategies: [{ id: 'forecast-residual-v1', status: 'approved', createdAt: now, approvedAt: now, notes: 'Initial paper-only baseline; not qualified for live trading.', parameters: { minimumEdge: 0.05 } }],
    activeStrategy: 'forecast-residual-v1', equityHistory: [], usedLiquidity: {},
  };
}
