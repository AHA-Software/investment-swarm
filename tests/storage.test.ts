import { afterEach,describe,it,expect } from 'vitest';
import { Store } from '../src/db.js';
import { tick, approveAndFill } from '../src/engine.js';
import { dollar, initialState } from '../src/domain.js';
import { NOW, market,book,forecast,prediction,intent,samples } from './fixtures.js';

const stores:Store[]=[];
async function open(){const store=await Store.open({directory:'memory://'});stores.push(store);await store.mutate(s=>Object.assign(s,initialState(NOW)));return store;}
afterEach(async()=>{for(const s of stores.splice(0))await s.close();});
async function seed(store:Store){await store.save('market',market().ticker,market(),NOW);await store.save('book',market().ticker,book(),NOW);await store.save('forecast','nyc:2026-11-09',forecast(),NOW);for(const s of samples())await store.addSample(s);}

describe('paper lifecycle and persistence',()=>{
  it('runs entry, partial exit, and unavailable liquidity without inventing fills',async()=>{
    const store=await open();await seed(store);await tick(store,NOW);
    let state=await store.state();expect(state.positions).toHaveLength(1);const original=state.positions[0]!.quantity;
    const later='2026-11-08T18:00:01.000Z';await store.save('book',market().ticker,book({receivedAt:later,yes:[{price:dollar(.25),quantity:3}]}),later);await tick(store,later);
    state=await store.state();expect(state.positions[0]!.quantity).toBe(original-3);expect(state.positions[0]!.exitReason).toContain('20%');
    await tick(store,later);expect((await store.state()).positions[0]!.quantity).toBe(original-3);
    const end='2026-11-08T18:00:02.000Z';await store.save('book',market().ticker,book({receivedAt:end,yes:[]}),end);await tick(store,end);
    state=await store.state();expect(state.positions).toHaveLength(1);expect(state.decisions.at(-1)!.action).toBe('exit_pending');expect(state.eventLocks).toContain(market().event);
    expect((await store.audit('fill')).length).toBe(2);
  },20000);
  it('settles winners before missing liquidity can incorrectly latch daily or cumulative loss',async()=>{
    const store=await open();await store.save('market',market().ticker,market({status:'settled',result:'yes'}),NOW);
    await store.mutate(s=>{s.cash=dollar(75);s.positions=[{id:'winner',ticker:market().ticker,event:market().event,side:'yes',quantity:50,cost:dollar(25),openedAt:NOW,strategyVersion:s.activeStrategy}];});
    await tick(store,NOW);const s=await store.state();expect(s.cash).toBe(dollar(125));expect(s.positions).toHaveLength(0);expect(s.paused).toBe(false);expect(s.halted).toBe(false);
  },20000);
  it('settles losing contracts and latches the actual loss',async()=>{const store=await open();await store.save('market',market().ticker,market({status:'settled',result:'no'}),NOW);await store.mutate(s=>{s.cash=dollar(95);s.positions=[{id:'loser',ticker:market().ticker,event:market().event,side:'yes',quantity:10,cost:dollar(5),openedAt:NOW,strategyVersion:s.activeStrategy}];});await tick(store,NOW);expect((await store.state()).paused).toBe(true);},20000);
  it('serializes simultaneous competing intents and exact duplicates',async()=>{const store=await open(),i=intent();const results=await Promise.all(Array.from({length:12},()=>store.mutate(s=>approveAndFill(s,i,market(),book(),forecast(),prediction(),NOW))));expect(results.filter(r=>r.approved)).toHaveLength(1);expect((await store.state()).positions).toHaveLength(1);},20000);
  it('rolls back both state and audit records after a failed transaction',async()=>{const store=await open();await expect(store.mutate(s=>{s.cash=0;throw new Error('simulated crash');})).rejects.toThrow('simulated crash');expect((await store.state()).cash).toBe(dollar(100));expect(await store.audit('fill')).toHaveLength(0);},20000);
  it('rejects malformed and non-day-ahead training timestamps',async()=>{const store=await open(),s=samples(1)[0]!;await expect(store.addSample({...s,settledAt:'nope'})).rejects.toThrow('timestamp');await expect(store.addSample({...s,forecastReceivedAt:s.date+'T12:00:00Z'})).rejects.toThrow('day-ahead');},20000);
  it('archives equity at numeric instants even when offsets differ',async()=>{const store=await open();await store.mutate(s=>s.equityHistory.push({timestamp:'2026-11-08T13:00:00-05:00',day:'2026-11-08',equity:dollar(100)}));await store.mutate(s=>s.equityHistory.push({timestamp:'2026-11-08T18:01:00Z',day:'2026-11-08',equity:dollar(99)}));expect(await store.audit('equity')).toHaveLength(2);},20000);
});
