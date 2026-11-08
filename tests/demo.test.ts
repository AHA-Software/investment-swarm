import { it,expect } from 'vitest';
import { Store } from '../src/db.js';
import { seedDemo } from '../src/demo.js';
import { evaluationInput } from '../src/evaluation.js';
it('keeps synthetic demonstration evidence separate and records attempted partial exits',async()=>{
  const store=await Store.open({directory:'memory://',fixture:true});
  try{
    const result=await seedDemo(store);expect(result.entry.positions).toBe(1);expect(result.partial.positions).toBe(1);expect(result.pending.decisions.at(-1)?.action).toBe('exit_pending');
    const state=await store.state();expect(state.positions[0]!.quantity).toBeGreaterThan(0);
    const evidence=await evaluationInput(store);expect(evidence.fixture).toBe(true);expect(evidence.fills.length).toBe(2);expect(evidence.fills.reduce((sum,f)=>sum+f.fee,0)).toBeGreaterThan(0);
  }finally{await store.close();}
},20000);
