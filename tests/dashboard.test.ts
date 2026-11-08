import { it,expect } from 'vitest';
import { Store } from '../src/db.js';
import { dashboard } from '../src/dashboard.js';
import { request } from 'node:http';
it('serves local paper state and rejects mutations and foreign hosts',async()=>{
  const store=await Store.open({directory:'memory://'}),server=await dashboard(store,0);
  try{
    const address=server.address();if(!address||typeof address==='string')throw new Error('No test server address');
    const base=`http://127.0.0.1:${address.port}`;
    const state=await(await fetch(base+'/api/status')).json();expect(state.liveEnabled).toBe(false);expect(state.equity).toBe(100_000_000);
    expect((await fetch(base+'/api/status',{method:'POST'})).status).toBe(405);
    const foreignHostStatus=await new Promise<number|undefined>((resolve,reject)=>{const req=request(base+'/api/status',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
    expect(foreignHostStatus).toBe(403);
    expect((await fetch(base+'/favicon.svg')).status).toBe(200);
    expect((await fetch(base+'/../.env')).status).toBe(404);
  }finally{await new Promise<void>(r=>server.close(()=>r()));await store.close();}
},20000);
