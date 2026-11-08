import { randomUUID } from 'node:crypto';
import { Store } from './db.js';
import { POLICY, USD, intentSchema, iso, localDate, validTime, epoch, type Book, type Decision, type Estimate, type Forecast, type Market, type Position, type State, type TradeIntent } from './domain.js';
import { asks, bids, sweep, fee } from './math.js';
import { estimate, evidenceIssues, patternSummary } from './model.js';

export function liquidation(position: Position, book: Book | undefined, feeRate = 0.07) {
  return book?.valid ? sweep(bids(book,position.side), position.quantity, 0, 'sell', feeRate).net : 0;
}
export function equity(state: State, books: Book[], markets: Market[], now = iso()) {
  return state.cash + state.positions.reduce((total,p) => {
    const market = markets.find(m=>m.ticker===p.ticker);
    if (market?.status==='settled' && market.result) return total+(market.result===p.side?p.quantity*USD:0);
    const book = books.find(b=>b.ticker===p.ticker);
    const fresh = book && validTime(book.receivedAt) && epoch(now)-epoch(book.receivedAt)<=POLICY.bookMaxAgeMs && epoch(book.receivedAt)<=epoch(now);
    return total + liquidation(p,fresh ? book : undefined,markets.find(m=>m.ticker===p.ticker)?.feeRate ?? 0.07);
  },0);
}
export function applyLossLimits(state: State, currentEquity: number, now: string) {
  if (!validTime(now) || !Number.isFinite(currentEquity)) throw new Error('Invalid loss-limit inputs');
  const day = localDate(now, 'America/Los_Angeles');
  if (state.day !== day) { state.day = day; state.dayStartEquity = state.equityHistory.at(-1)?.equity ?? currentEquity; }
  if (POLICY.bankroll-currentEquity >= POLICY.cumulativeLoss) {
    state.halted = true; state.paused = true; state.pauseReason = 'Cumulative pilot loss reached $20';
  } else if (!state.paused && state.dayStartEquity-currentEquity >= POLICY.dailyLoss) {
    state.paused = true; state.pauseReason = 'Daily loss reached $5';
  }
}
function decision(state: State, ticker: string, agent: string, action: string, reasons: string[], now: string, extra: Partial<Decision> = {}) {
  state.decisions.push({ id: randomUUID(), timestamp: now, ticker, agent, action, reasons, ...extra });
}
function consume(book: Book, side: 'yes'|'no', action: 'buy'|'sell', fills: {quantity:number;price:number}[]) {
  const levels = book[action==='buy' ? side==='yes'?'no':'yes' : side];
  for (const fill of fills) {
    const price = action==='buy' ? USD-fill.price : fill.price;
    const level = levels.find(l=>l.price===price);
    if (level) level.quantity = Math.max(0,level.quantity-fill.quantity);
  }
}
export function entryIntent(market: Market, book: Book, prediction: Estimate, minimumEdge: number, now: string): TradeIntent | null {
  let best: TradeIntent | null = null, bestScore = 0;
  for (const side of ['yes','no'] as const) {
    const probability = side==='yes' ? prediction.probability : 1-prediction.probability;
    const levels = asks(book,side), top = levels[0];
    if (!top || top.price<=0 || market.feeRate===null) continue;
    // Only consume the best quoted level; integer quantities deliberately simplify v1.
    let quantity = Math.min(1000, Math.floor(top.quantity), Math.floor(POLICY.eventCap/top.price));
    while (quantity>0 && (quantity*top.price+fee(quantity,top.price,market.feeRate)>POLICY.eventCap || probability-top.price/USD-(2*fee(quantity,top.price,market.feeRate))/(quantity*USD)<minimumEdge)) quantity--;
    if (!quantity) continue;
    const score = quantity*(probability*USD-top.price)-2*fee(quantity,top.price,market.feeRate);
    if (score>bestScore) {
      bestScore = score;
      best = { id: randomUUID(), ticker: market.ticker, event: market.event, side, quantity, limitPrice: top.price, probability, strategyVersion: prediction.modelVersion, createdAt: now, expiresAt: new Date(Date.parse(now)+5000).toISOString(), rulesHash: market.rulesHash,
        rationale: `Forecast residual model; ${prediction.samples} station samples; estimated net advantage >= ${(minimumEdge*100).toFixed(1)} cents per contract.` };
    }
  }
  return best;
}
export function approveAndFill(state: State, rawIntent: TradeIntent, market: Market, book: Book, forecast: Forecast, prediction: Estimate, now: string) {
  const intent = intentSchema.parse(rawIntent), reasons = evidenceIssues(market,forecast,book,prediction,now);
  if (state.processedIntents.includes(intent.id)) return { approved: false, reasons: ['Duplicate intent'], filled: 0 };
  state.processedIntents.push(intent.id);
  if (state.mode!=='paper') reasons.push('Only paper execution is implemented');
  if (state.paused || state.halted) reasons.push(state.pauseReason ?? 'Trading paused');
  if (intent.ticker!==market.ticker || intent.event!==market.event || book.ticker!==market.ticker || prediction.ticker!==market.ticker) reasons.push('Mismatched intent inputs');
  if (intent.rulesHash!==market.rulesHash) reasons.push('Contract rules changed');
  if (intent.strategyVersion!==state.activeStrategy || !state.strategies.some(s=>s.id===intent.strategyVersion && s.status==='approved')) reasons.push('Strategy is not the approved active version');
  if (Date.parse(intent.expiresAt)<=Date.parse(now) || Date.parse(intent.createdAt)>Date.parse(now)) reasons.push('Expired or future intent');
  if (state.eventLocks.includes(intent.event) || state.positions.some(p=>p.event===intent.event)) reasons.push('Event already held or locked after exit');
  const cost = intent.quantity*intent.limitPrice+fee(intent.quantity,intent.limitPrice,market.feeRate??0.07);
  if (cost>POLICY.eventCap) reasons.push('Event cap exceeded');
  if (state.positions.reduce((a,p)=>a+p.cost,0)+cost>POLICY.totalCap) reasons.push('Portfolio commitment cap exceeded');
  if (cost>state.cash) reasons.push('Insufficient cash');
  const p = intent.side==='yes' ? prediction.probability : 1-prediction.probability;
  const minimumEdge = state.strategies.find(s=>s.id===state.activeStrategy)!.parameters.minimumEdge;
  if (p-intent.limitPrice/USD-2*fee(intent.quantity,intent.limitPrice,market.feeRate??0.07)/(intent.quantity*USD)<Math.max(minimumEdge,POLICY.minimumEdge)) reasons.push('Insufficient independently recomputed advantage');
  if (reasons.length) { decision(state,intent.ticker,'risk','reject',reasons,now,{intent,estimate:prediction}); return { approved:false,reasons,filled:0 }; }
  const execution = sweep(asks(book,intent.side),intent.quantity,intent.limitPrice,'buy',market.feeRate!);
  if (execution.quantity) {
    state.cash -= execution.net;
    state.positions.push({id:randomUUID(), ticker:intent.ticker,event:intent.event,side:intent.side,quantity:execution.quantity,cost:execution.net,openedAt:now,strategyVersion:intent.strategyVersion});
    for (const f of execution.fills) state.fills.push({id:randomUUID(),intentId:intent.id,ticker:intent.ticker,side:intent.side,action:'buy',...f,timestamp:now,realizedPnl:0});
    consume(book,intent.side,'buy',execution.fills);
  }
  decision(state,intent.ticker,'execution',execution.quantity?'buy':'unfilled',[intent.rationale,`${execution.quantity}/${intent.quantity} contracts filled; remainder canceled (IOC).`],now,{intent,estimate:prediction});
  return { approved:true,reasons:[],filled:execution.quantity };
}
export async function tick(store: Store, now = iso(), allowEntries = true) {
  if (!validTime(now)) throw new Error('Invalid tick timestamp');
  const [markets, rawBooks, forecasts, samples] = await Promise.all([store.markets(),store.books(),store.forecasts(),store.samples()]);
  const books = structuredClone(rawBooks);
  return store.mutate(state=> {
    for (const book of books) {
      const used = state.usedLiquidity[book.ticker];
      if (used?.receivedAt===book.receivedAt) for (const side of ['yes','no'] as const) for (const l of book[side]) l.quantity = Math.max(0,l.quantity-(used[side][String(l.price)]??0));
    }
    const beforeBooks = structuredClone(books);
    applyLossLimits(state,equity(state,books,markets,now),now);
    for (const position of [...state.positions]) {
      const market = markets.find(m=>m.ticker===position.ticker), book = books.find(b=>b.ticker===position.ticker);
      if (!market) continue;
      if (market.result && market.status==='settled') {
        const payout = market.result===position.side ? position.quantity*USD : 0;
        state.cash += payout;
        state.fills.push({id:randomUUID(),intentId:`settle-${position.id}`,ticker:position.ticker,side:position.side,action:'settle',quantity:position.quantity,price:market.result===position.side?USD:0,fee:0,timestamp:now,realizedPnl:payout-position.cost});
        state.positions = state.positions.filter(p=>p.id!==position.id);
        decision(state,position.ticker,'execution','settled',[`Official Kalshi result: ${market.result}`],now);
        continue;
      }
      const forecast = forecasts.find(f=>f.city===market.city && f.date===market.date);
      const prediction = forecast ? estimate(market,forecast,samples,now,state.activeStrategy,state.fixture) : undefined;
      const fresh = book?.valid && validTime(book.receivedAt) && epoch(book.receivedAt)<=epoch(now) && epoch(now)-epoch(book.receivedAt)<=POLICY.bookMaxAgeMs;
      if (state.paused) position.exitReason ??= state.pauseReason ?? 'Operator pause';
      if (fresh && liquidation(position,book,market.feeRate??0.07)<=position.cost*POLICY.stopRatio) position.exitReason ??= '20% position loss threshold';
      if (forecast && prediction && fresh && evidenceIssues(market,forecast,book,prediction,now).length===0) {
        const p = position.side==='yes' ? prediction.probability : 1-prediction.probability;
        if (p*position.quantity*USD<liquidation(position,book,market.feeRate??0.07)) position.exitReason ??= 'Updated evidence favors selling';
      }
      if (!position.exitReason) continue;
      if (!state.eventLocks.includes(position.event)) state.eventLocks.push(position.event);
      if (!fresh || !book || !['active','open'].includes(market.status) || !validTime(market.closeAt) || epoch(market.closeAt)<=epoch(now)) { decision(state,position.ticker,'execution','exit_pending',[position.exitReason,'No fresh executable market; continue monitoring.'],now); continue; }
      const execution = sweep(bids(book,position.side),position.quantity,1,'sell',market.feeRate??0.07);
      if (execution.quantity) {
        const originalQty = position.quantity, originalCost = position.cost;
        const allocatedCost = execution.quantity===originalQty ? originalCost : Math.floor(originalCost*execution.quantity/originalQty);
        state.cash += execution.net;
        let remainingCost = allocatedCost;
        execution.fills.forEach((f,index)=> {
          const cost = index===execution.fills.length-1 ? remainingCost : Math.floor(allocatedCost*f.quantity/execution.quantity);
          remainingCost -= cost;
          state.fills.push({id:randomUUID(),intentId:`exit-${position.id}`,ticker:position.ticker,side:position.side,action:'sell',...f,timestamp:now,realizedPnl:f.price*f.quantity-f.fee-cost});
        });
        position.quantity -= execution.quantity; position.cost -= allocatedCost;
        consume(book,position.side,'sell',execution.fills);
        if (!position.quantity) state.positions = state.positions.filter(p=>p.id!==position.id);
      }
      decision(state,position.ticker,'execution',execution.remaining?'exit_pending':'sell',[position.exitReason,`${execution.quantity} contracts sold; ${execution.remaining} remain.`],now);
    }
    applyLossLimits(state,equity(state,books,markets,now),now);
    if (allowEntries && !state.paused && !state.halted) {
      const candidates: {market:Market;book:Book;forecast:Forecast;prediction:Estimate;intent:TradeIntent}[] = [];
      const strategy = state.strategies.find(s=>s.id===state.activeStrategy)!;
      for (const market of markets) {
        if (state.eventLocks.includes(market.event) || state.positions.some(p=>p.event===market.event)) continue;
        const book = books.find(b=>b.ticker===market.ticker), forecast = forecasts.find(f=>f.city===market.city && f.date===market.date);
        const prediction = forecast ? estimate(market,forecast,samples,now,state.activeStrategy,state.fixture) : undefined;
        const issues = evidenceIssues(market,forecast,book,prediction,now);
        if (issues.length) { decision(state,market.ticker,'critic','skip',issues,now,prediction?{estimate:prediction}:{}); continue; }
        const intent = entryIntent(market,book!,prediction!,strategy.parameters.minimumEdge,now);
        if (intent) candidates.push({market,book:book!,forecast:forecast!,prediction:prediction!,intent});
        else decision(state,market.ticker,'pattern','skip',['No opportunity clears modeled costs and minimum advantage.',JSON.stringify(patternSummary(book!))],now,{estimate:prediction});
      }
      candidates.sort((a,b)=>(b.intent.probability-b.intent.limitPrice/USD)*b.intent.quantity-(a.intent.probability-a.intent.limitPrice/USD)*a.intent.quantity);
      for (const c of candidates) {
        applyLossLimits(state,equity(state,books,markets,now),now);
        approveAndFill(state,c.intent,c.market,c.book,c.forecast,c.prediction,now);
      }
    }
    const current = equity(state,books,markets,now);
    applyLossLimits(state,current,now);
    if (!state.equityHistory.length || epoch(now)-epoch(state.equityHistory.at(-1)!.timestamp)>=60_000) state.equityHistory.push({timestamp:now,equity:current,day:state.day});
    for (const book of books) {
      const previous = state.usedLiquidity[book.ticker];
      const usage = previous?.receivedAt===book.receivedAt ? previous : {receivedAt:book.receivedAt,yes:{},no:{}};
      const before = beforeBooks.find(b=>b.ticker===book.ticker)!;
      for (const side of ['yes','no'] as const) for (const l of book[side]) usage[side][String(l.price)] = (usage[side][String(l.price)]??0)+Math.max(0,(before[side].find(v=>v.price===l.price)?.quantity??0)-l.quantity);
      state.usedLiquidity[book.ticker] = usage;
    }
    return { timestamp:now,equity:current,cash:state.cash,positions:state.positions.length,paused:state.paused,halted:state.halted,decisions:state.decisions.slice(-Math.min(markets.length+5,50)) };
  });
}
export class LiveExecutionUnavailable extends Error { constructor() { super('Live trading is not implemented or enabled. Paper qualification and explicit launch approval are required.'); } }
export function requirePaperMode() { if ((process.env.TRADING_MODE??'paper')!=='paper') throw new LiveExecutionUnavailable(); }
