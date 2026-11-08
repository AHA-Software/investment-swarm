import { it,expect,vi } from 'vitest';
import { Store } from '../src/db.js';
import { runPaper } from '../src/runner.js';
import { Collector } from '../src/collector.js';
it('monitors the portfolio even while weather collection is blocked',async()=>{
  const store=await Store.open({directory:'memory://'}),controller=new AbortController();
  let release:()=>void=()=>{};
  const weatherBlocked=new Promise<void>(resolve=>release=resolve);
  const collector={discover:vi.fn(async()=>({count:0})),weatherSnapshot:vi.fn(()=>weatherBlocked),books:vi.fn(async()=>({count:0})),settlements:vi.fn(async()=>({settled:0}))} as unknown as Collector;
  const running=runPaper(store,controller.signal,collector);
  try{await new Promise(r=>setTimeout(r,1200));expect((await store.state()).equityHistory.length).toBeGreaterThan(0);expect(collector.weatherSnapshot).toHaveBeenCalledOnce();}
  finally{controller.abort();release();await running;await store.close();}
},20000);
