import { setTimeout as delay } from 'node:timers/promises';
import { Collector } from './collector.js';
import { Store } from './db.js';
import { tick } from './engine.js';
import { iso } from './domain.js';

// Separate loops keep weather/API delays out of the stop-monitoring schedule.
export async function runPaper(store:Store,signal:AbortSignal,collector=new Collector(store)) {
  const loop=async(name:string,interval:number,work:()=>Promise<unknown>)=>{
    while(!signal.aborted){
      try{const result=await work();if(name!=='books'&&name!=='engine')console.log(JSON.stringify({service:name,result}));}
      catch(error){if(!signal.aborted){const message=error instanceof Error?error.message:String(error);console.error(`${name}: ${message}`);try{await store.save('health',name,{at:iso(),error:message});}catch{/* Preserve service independence during database recovery. */}}}
      try{await delay(interval,undefined,{signal});}catch{break;}
    }
  };
  let lastEntries=0;
  await Promise.all([
    loop('discovery',600_000,()=>collector.discover()),
    loop('weather',300_000,()=>collector.weatherSnapshot()),
    loop('books',1000,()=>collector.books()),
    loop('settlements',300_000,()=>collector.settlements()),
    loop('engine',1000,async()=>{const allowEntries=Date.now()-lastEntries>=60_000;const result=await tick(store,iso(),allowEntries);if(allowEntries){lastEntries=Date.now();const {decisions,...summary}=result;console.log(JSON.stringify({...summary,decisionCount:decisions.length}));}return result;}),
  ]);
}
