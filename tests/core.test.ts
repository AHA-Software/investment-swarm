import { describe,it,expect } from 'vitest';
import { dollar, POLICY, USD, localDate } from '../src/domain.js';
import { applyLossLimits, approveAndFill, equity, requirePaperMode } from '../src/engine.js';
import { evidenceIssues, estimate } from '../src/model.js';
import { parsePrice, rangeProbability, sweep } from '../src/math.js';
import { normalizeMarket, normalizeBook } from '../src/kalshi.js';
import { normalizeForecast } from '../src/weather.js';
import { NOW,book,forecast,intent,market,prediction,samples,state } from './fixtures.js';

describe('money and market normalization',()=>{
  it('parses fixed-point subpenny prices without cent truncation',()=>{expect(parsePrice('0.1234')).toBe(123400);expect(()=>parsePrice('NaN')).toThrow();expect(()=>parsePrice('1.0001')).toThrow();});
  it('derives inclusive integer bounds and verifies settlement station',()=>{
    const raw={ticker:market().ticker,event_ticker:market().event,title:'high',close_time:market().closeAt,status:'active',rules_primary:'If the maximum temperature at New York City (CLINYC) is greater than 64° fahrenheit according to The Weather Company',strike_type:'greater',floor_strike:64};
    expect(normalizeMarket(raw,'nyc',0.07)).toMatchObject({lower:65,upper:null,rulesVerified:true,source:'The Weather Company'});
    expect(normalizeMarket({...raw,rules_primary:raw.rules_primary.replace('CLINYC','CLIMDW')},'nyc',0.07).rulesVerified).toBe(false);
  });
  it('rejects unknown schema and crossed books',()=>{expect(normalizeBook('x',{orderbook_fp:{yes_dollars:[['0.60','2']],no_dollars:[['0.45','2']]}}).valid).toBe(false);expect(()=>normalizeBook('x',{})).toThrow();});
  it('temperature bins form a complete distribution',()=>{expect(rangeProbability(65,3,null,64)+rangeProbability(65,3,65,66)+rangeProbability(65,3,67,null)).toBeCloseTo(1,7);});
  it('does not invent liquidity and charges conservative fees',()=>{const r=sweep([{price:dollar(.4),quantity:2}],10,dollar(.4),'buy',.07);expect(r.quantity).toBe(2);expect(r.remaining).toBe(8);expect(r.net).toBeGreaterThan(dollar(.8));});
});
describe('deterministic risk',()=>{
  it('fills at bounded prices and deduplicates the exact intent',()=>{const s=state(),i=intent(),b=book();expect(approveAndFill(s,i,market(),b,forecast(),prediction(),NOW).filled).toBe(10);expect(approveAndFill(s,i,market(),b,forecast(),prediction(),NOW).reasons).toContain('Duplicate intent');expect(s.positions).toHaveLength(1);expect(s.cash).toBeLessThan(dollar(96));});
  it('aggregates buckets into the same city/date event',()=>{const s=state();approveAndFill(s,intent(),market(),book(),forecast(),prediction(),NOW);const m=market({ticker:'KXHIGHNY-26NOV09-T63'});const r=approveAndFill(s,intent({ticker:m.ticker}),m,book({ticker:m.ticker}),forecast(),prediction({ticker:m.ticker}),NOW);expect(r.approved).toBe(false);expect(r.reasons).toContain('Event already held or locked after exit');});
  it('rejects oversized positions and total committed exposure',()=>{const s=state();expect(approveAndFill(s,intent({quantity:20}),market(),book(),forecast(),prediction(),NOW).reasons).toContain('Event cap exceeded');s.positions.push({id:'held',ticker:'other',event:'other',side:'yes',quantity:60,cost:dollar(23),openedAt:NOW,strategyVersion:s.activeStrategy});expect(approveAndFill(s,intent(),market(),book(),forecast(),prediction(),NOW).reasons).toContain('Portfolio commitment cap exceeded');});
  it('does not trust the probability in an agent intent',()=>{expect(approveAndFill(state(),intent({probability:1}),market(),book(),forecast(),prediction({probability:.1}),NOW).reasons).toContain('Insufficient independently recomputed advantage');});
  it('rejects entries with no exit depth or an immediate stop-loss breach',()=>{for(const b of [book({yes:[]}),book({yes:[{price:dollar(.1),quantity:100}]})])expect(approveAndFill(state(),intent(),market(),b,forecast(),prediction(),NOW).reasons).toContain('Entry has insufficient exit depth or already crosses the loss trigger');});
  it('pauses at daily loss and keeps the pause after midnight',()=>{const s=state();applyLossLimits(s,dollar(95),NOW);expect(s.paused).toBe(true);applyLossLimits(s,dollar(100),'2026-11-09T09:00:00.000Z');expect(s.paused).toBe(true);});
  it('latches cumulative loss despite recovery or a day boundary',()=>{const s=state();applyLossLimits(s,dollar(80),NOW);expect(s.halted).toBe(true);applyLossLimits(s,dollar(100),'2026-11-09T09:00:00.000Z');expect(s.halted).toBe(true);});
  it('marks missing liquidity to zero but credits authoritative settled payouts',()=>{const s=state();s.cash=dollar(95);s.positions.push({id:'p',ticker:market().ticker,event:market().event,side:'yes',quantity:10,cost:dollar(5),openedAt:NOW,strategyVersion:s.activeStrategy});expect(equity(s,[],[market()],NOW)).toBe(dollar(95));expect(equity(s,[],[market({status:'settled',result:'yes'})],NOW)).toBe(dollar(105));});
  it('rejects live mode',()=>{process.env.TRADING_MODE='live';try{expect(requirePaperMode).toThrow('Live trading');}finally{delete process.env.TRADING_MODE;}});
});
describe('time and evidence',()=>{
  it('fails closed on malformed timestamps in every evidence input',()=>{for(const changes of [{book:book({receivedAt:'nope'})},{forecast:forecast({publishedAt:'nope'})},{forecast:forecast({receivedAt:'nope'})},{prediction:prediction({availableAt:'nope'})},{prediction:prediction({trainedThrough:'nope'})}])expect(evidenceIssues(market(),changes.forecast??forecast(),changes.book??book(),changes.prediction??prediction(),NOW)).toContain('Malformed timestamp');});
  it('handles equivalent timestamp offsets as equal instants',()=>{expect(evidenceIssues(market(),forecast({receivedAt:'2026-11-08T13:00:00-05:00'}),book({receivedAt:'2026-11-08T13:00:00-05:00'}),prediction({availableAt:'2026-11-08T13:00:00-05:00'}),NOW)).toEqual([]);});
  it('rejects future model labels expressed with an offset',()=>{const s=samples(1)[0]!;s.settledAt='2026-11-08T08:00:00-05:00';expect(estimate(market(),forecast(),[s],'2026-11-08T12:00:00.000Z','v1').samples).toBe(0);expect(evidenceIssues(market(),forecast(),book(),prediction({trainedThrough:'2026-11-08T14:00:00-05:00'}),NOW)).toContain('Invalid prediction or future training labels');});
  it('rejects missing training, stale books, future forecasts, and intraday vintages',()=>{expect(evidenceIssues(market(),forecast(),book({receivedAt:'2026-11-08T17:00:00Z'}),prediction({samples:0}),NOW)).toHaveLength(2);expect(evidenceIssues(market(),forecast({publishedAt:'2026-11-08T14:00:00-05:00'}),book(),prediction(),NOW).join()).toContain('future');expect(evidenceIssues(market({date:'2026-11-08'}),forecast({date:'2026-11-08'}),book(),prediction(),NOW).join()).toContain('day-ahead');});
  it('binds labels to source, station, vintage and real-data mode',()=>{const base=samples(1)[0]!;for(const mutation of [{source:'other'},{station:'CLIMDW'},{forecastReceivedAt:'broken'},{fixture:true}])expect(estimate(market(),forecast(),[{...base,...mutation}],NOW,'v1').samples).toBe(0);expect(estimate(market(),forecast(),[{...base,fixture:true}],NOW,'v1',true).samples).toBe(1);});
  it('handles DST boundaries in local dates',()=>{expect(localDate('2026-11-01T05:30:00Z','America/New_York')).toBe('2026-11-01');expect(localDate('2026-11-01T06:30:00Z','America/New_York')).toBe('2026-11-01');});
  it('rejects malformed forecast timestamps at ingestion',()=>{expect(()=>normalizeForecast({properties:{updateTime:'garbage',periods:[]}},'nyc',NOW)).toThrow();});
});
