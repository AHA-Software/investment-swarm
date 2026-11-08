import { spawn } from 'node:child_process';
import { Store } from './db.js';
import { USD, type Decision, type Fill } from './domain.js';

export async function evaluationInput(store:Store) {
  const [state,fills,decisions,markets,samples]=await Promise.all([store.state(),store.audit<Fill>('fill'),store.audit<Decision>('decision'),store.markets(),store.samples()]);
  const predictions=decisions.filter(d=>d.action==='buy'&&d.intent?.strategyVersion===state.activeStrategy).map(d=>{
    const market=markets.find(m=>m.ticker===d.ticker);
    return {event:d.intent!.event,city:market?.city,date:market?.date,probability:d.intent!.probability,
      outcome:market?.result ? Number(market.result===d.intent!.side) : null,
      marketProbability:d.intent!.limitPrice/USD,timestamp:d.timestamp};
  });
  return {fixture:state.fixture,strategyVersion:state.activeStrategy,startedAt:state.strategies.find(s=>s.id===state.activeStrategy)?.approvedAt??state.startedAt,now:new Date().toISOString(),openPositions:state.positions.length,paused:state.paused,halted:state.halted,
    fills:fills.filter(f=>f.strategyVersion===state.activeStrategy).map(f=>({...f,realizedPnl:f.realizedPnl/USD,fee:f.fee/USD})),predictions,samples};
}
export async function evaluate(store:Store) {
  const input=await evaluationInput(store);
  return new Promise<Record<string,unknown>>((resolve,reject)=> {
    const child=spawn('uv',['run','--project','modeling','python','modeling/evaluate.py'],{stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    child.on('error',reject);
    child.on('close',code=>{if(code!==0)reject(new Error(`Evaluation worker failed (${code}): ${stderr.slice(-3000)}`));else{try{resolve(JSON.parse(stdout));}catch{reject(new Error('Evaluation worker returned invalid JSON'));}}});
    child.stdin.end(JSON.stringify(input));
  });
}
