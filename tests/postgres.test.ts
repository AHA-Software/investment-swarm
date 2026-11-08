import { describe,it,expect } from 'vitest';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/db.js';
import { approveAndFill } from '../src/engine.js';
import { NOW, market,book,forecast,prediction,intent } from './fixtures.js';
import { dollar,initialState,POLICY,CITIES,weatherEvent } from '../src/domain.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('real PostgreSQL contention',()=>{
  it('enforces global caps and idempotency across independent pools',async()=>{
    const parent=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL}),name='swarm_test_'+randomUUID().replaceAll('-','');
    let a:Store|undefined,b:Store|undefined;
    try{
      await parent.query(`CREATE DATABASE "${name}"`);const url=new URL(process.env.TEST_DATABASE_URL!);url.pathname='/'+name;
      a=await Store.open({url:url.toString()});b=await Store.open({url:url.toString()});
      await a.mutate(s=>Object.assign(s,initialState(NOW)));
      const shared=intent();const dup=await Promise.all(Array.from({length:12},(_,i)=>(i%2?a!:b!).mutate(s=>approveAndFill(s,shared,market(),book(),forecast(),prediction(),NOW))));
      expect(dup.filter(r=>r.approved)).toHaveLength(1);
      await a.mutate(s=>{for(let i=0;i<4;i++)s.positions.push({id:`prior-${i}`,ticker:`prior-${i}`,event:`prior-${i}`,side:'yes',quantity:10,cost:dollar(4),openedAt:NOW,strategyVersion:s.activeStrategy});s.cash-=dollar(16);});
      const results=await Promise.all(Array.from({length:12},(_,i)=>{
        const city=i%2?'chicago':'miami',event=weatherEvent(city,'2026-11-09'),ticker=event+'-B'+i,m=market({city,event,ticker,station:CITIES[city].climateStation});
        return (i%2?a!:b!).mutate(s=>approveAndFill(s,intent({event,ticker}),m,book({ticker}),forecast({city}),prediction({ticker}),NOW));
      }));
      expect(results.filter(r=>r.approved).length).toBeGreaterThan(0);const state=await a.state();expect(state.positions.reduce((n,p)=>n+p.cost,0)).toBeLessThanOrEqual(POLICY.totalCap);expect(state.cash).toBeGreaterThanOrEqual(dollar(75));
      const secondBucket=market({ticker:'KXHIGHNY-26NOV09-T63'});const r=await b.mutate(s=>approveAndFill(s,intent({ticker:secondBucket.ticker}),secondBucket,book({ticker:secondBucket.ticker}),forecast(),prediction({ticker:secondBucket.ticker}),NOW));expect(r.approved).toBe(false);
    }finally{await a?.close();await b?.close();await parent.query(`DROP DATABASE IF EXISTS "${name}"`);await parent.end();}
  },30000);
});
