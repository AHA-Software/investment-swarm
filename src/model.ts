import { CITIES, POLICY, USD, epoch, localDate, validTime, type Estimate, type Forecast, type Market, type TrainingSample } from './domain.js';
import { rangeProbability, asks, bids } from './math.js';
import type { Book } from './domain.js';

export function estimate(market: Market, forecast: Forecast, samples: TrainingSample[], now: string, modelVersion: string, fixture = false): Estimate {
  // A day-ahead model may only use day-ahead forecasts and labels available at decision time.
  const eligible = samples.filter(s => s.city === market.city && s.station === market.station && s.source === market.source && s.event.startsWith(CITIES[market.city].series+'-') && s.date < market.date && [s.settledAt,s.forecastPublishedAt,s.forecastReceivedAt].every(validTime) && epoch(s.settledAt) <= epoch(now) && epoch(s.forecastPublishedAt) <= epoch(s.forecastReceivedAt) && epoch(s.forecastReceivedAt) < epoch(s.settledAt) && localDate(s.forecastReceivedAt,CITIES[s.city].timezone)<s.date && s.horizon === 'day-ahead' && (fixture || !s.fixture));
  const errors = eligible.slice(-180).map(s => s.observedHigh - s.forecastHigh);
  const bias = errors.length ? errors.reduce((a,b)=>a+b,0)/errors.length : 0;
  const sigma = Math.max(2, errors.length > 1 ? Math.sqrt(errors.reduce((a,b)=>a+(b-bias)**2,0)/(errors.length-1)) : 4);
  return { ticker: market.ticker, probability: rangeProbability(forecast.highF+bias, sigma, market.lower, market.upper), sigma, bias, samples: errors.length, modelVersion, availableAt: now, trainedThrough: eligible.length ? new Date(Math.max(...eligible.map(s=>epoch(s.settledAt)))).toISOString() : null };
}
export function evidenceIssues(market: Market, forecast: Forecast | undefined, book: Book | undefined, prediction: Estimate | undefined, now: string): string[] {
  const issues: string[] = [], t = Date.parse(now);
  if (!validTime(now) || !validTime(market.closeAt) || (book && !validTime(book.receivedAt)) || (forecast && ![forecast.publishedAt,forecast.receivedAt].every(validTime)) || (prediction && (!validTime(prediction.availableAt) || (prediction.trainedThrough!==null && !validTime(prediction.trainedThrough))))) issues.push('Malformed timestamp');
  if (!market.rulesVerified) issues.push('Contract station, bounds, or settlement rules unverified');
  if (market.feeRate === null) issues.push('Unsupported or unavailable fee schedule');
  if (!['active','open'].includes(market.status)) issues.push('Market is not open');
  if (Date.parse(market.closeAt) <= t + 60*60_000) issues.push('Less than one hour until market close');
  if (!book?.valid || !book || t-Date.parse(book.receivedAt) > POLICY.bookMaxAgeMs || Date.parse(book.receivedAt) > t) issues.push('Order book unavailable, crossed, stale, or from the future');
  if (!forecast || !forecast.complete || forecast.date !== market.date || forecast.city !== market.city) issues.push('Complete station/date forecast unavailable');
  if (forecast && validTime(forecast.receivedAt) && localDate(forecast.receivedAt,CITIES[market.city].timezone)>=market.date) issues.push('v1 requires a day-ahead forecast vintage');
  if (forecast && (Date.parse(forecast.publishedAt) > t || Date.parse(forecast.receivedAt) > t || t-Date.parse(forecast.publishedAt) > POLICY.forecastMaxAgeMs || t-Date.parse(forecast.receivedAt) > POLICY.forecastPollMaxAgeMs)) issues.push('Forecast stale or from the future');
  if (!prediction || prediction.samples < POLICY.minSamples) issues.push(`Need ${POLICY.minSamples} settled day-ahead samples for this station`);
  if (prediction && (!Number.isFinite(prediction.probability) || prediction.probability < 0 || prediction.probability > 1 || (validTime(prediction.availableAt) && epoch(prediction.availableAt) > t) || (prediction.trainedThrough !== null && validTime(prediction.trainedThrough) && epoch(prediction.trainedThrough) > t))) issues.push('Invalid prediction or future training labels');
  return issues;
}
export function patternSummary(book: Book) {
  const yesDepth = bids(book,'yes').slice(0,5).reduce((a,b)=>a+b.quantity,0);
  const noDepth = bids(book,'no').slice(0,5).reduce((a,b)=>a+b.quantity,0);
  return { yesSpread: asks(book,'yes')[0] ? (asks(book,'yes')[0]!.price-(bids(book,'yes')[0]?.price??0))/USD : null,
    depthImbalance: yesDepth+noDepth ? (yesDepth-noDepth)/(yesDepth+noDepth) : 0,
    note: 'Liquidity diagnostic only; not an independently qualified predictive signal.' };
}
