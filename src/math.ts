import { Decimal } from 'decimal.js';
import { USD, type Book, type Level, type Side } from './domain.js';

export function parsePrice(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(\.\d{1,6})?$/.test(value)) throw new Error('Expected fixed-point dollar string');
  const n = new Decimal(value).mul(USD).toNumber();
  if (!Number.isSafeInteger(n) || n < 0 || n > USD) throw new Error('Invalid contract price');
  return n;
}
// Conservative paper fees: round each consumed level up to a cent; no rounding rebates.
// This intentionally overestimates current direct-member rounding fees.
export function fee(quantity: number, price: number, rate: number): number {
  return new Decimal(quantity).mul(price).div(USD).mul(new Decimal(1).minus(new Decimal(price).div(USD))).mul(rate).mul(100).ceil().mul(10_000).toNumber();
}
export function asks(book: Book, side: Side): Level[] {
  return book[side === 'yes' ? 'no' : 'yes'].map(l => ({ price: USD - l.price, quantity: l.quantity })).sort((a, b) => a.price - b.price);
}
export function bids(book: Book, side: Side): Level[] { return [...book[side]].sort((a, b) => b.price - a.price); }
export function sweep(levels: Level[], quantity: number, limit: number, action: 'buy' | 'sell', rate: number) {
  let remaining = quantity, principal = 0, fees = 0;
  const fills: { quantity: number; price: number; fee: number }[] = [];
  for (const level of levels) {
    if (action === 'buy' ? level.price > limit : level.price < limit) break;
    const count = Math.min(remaining, Math.floor(level.quantity));
    if (count <= 0) continue;
    const f = fee(count, level.price, rate);
    if (action==='sell' && count*level.price<=f) continue;
    principal += level.price * count; fees += f; remaining -= count;
    fills.push({ quantity: count, price: level.price, fee: f });
    if (!remaining) break;
  }
  return { quantity: quantity - remaining, remaining, principal, fees, net: action === 'buy' ? principal + fees : Math.max(0, principal - fees), fills };
}
export function normalCdf(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-x * x / 2);
  const p = 1 - d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? p : 1 - p;
}
export function rangeProbability(mean: number, sigma: number, lower: number | null, upper: number | null) {
  // Bounds describe integer reported temperatures; continuity-correct their inclusive range.
  const lo = lower === null ? 0 : normalCdf((lower - 0.5 - mean) / sigma);
  const hi = upper === null ? 1 : normalCdf((upper + 0.5 - mean) / sigma);
  return Math.max(0, Math.min(1, hi - lo));
}
