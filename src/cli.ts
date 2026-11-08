import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './db.js';
import { Collector } from './collector.js';
import { dashboard, status } from './dashboard.js';
import { tick, requirePaperMode, applyLossLimits, equity } from './engine.js';
import { seedDemo } from './demo.js';
import { mcpRead, mcpTools } from './mcp.js';
import { streamBooks } from './stream.js';
import { evaluate, evaluationInput } from './evaluation.js';
import { runPaper } from './runner.js';
import { POLICY, iso } from './domain.js';

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)),'..'));
try{process.loadEnvFile('.env');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
const args=process.argv.slice(2),command=args[0]??'help';
const print=(v:unknown)=>console.log(JSON.stringify(v,null,2));
const value=(flag:string)=>{const index=args.indexOf(flag);return index>=0?args[index+1]:undefined;};
const controller=new AbortController();
process.once('SIGINT',()=>controller.abort());process.once('SIGTERM',()=>controller.abort());
async function main(){
  requirePaperMode();
  if(command==='help'){console.log(`Investment Swarm — paper-only weather research

  npm run demo                    Synthetic entry + partial exit + missing liquidity
  npm run dev                     Read-only local dashboard (port 4310)
  npm run collect                 Collect public Kalshi and NWS data once
  npm run paper                   Continuous collector, paper engine, and dashboard
  npm run mcp:check                Inspect official public MCP tools
  npm run swarm -- mcp get_market '{"market_ticker":"..."}'
  npm run swarm -- stream          Authenticated read-only WebSocket collection
  npm run swarm -- status          Current portfolio and readiness
  npm run swarm -- report          Offline Python performance/gating report
  npm run swarm -- export          Machine-readable evaluation input
  npm run swarm -- pause           Latch operator pause and attempt exits
  npm run swarm -- resume          Manual resume only if loss limits permit
  npm run swarm -- propose         Create a strategy proposal with current evidence
  npm run swarm -- approve <id>    Approve a reviewed candidate for PAPER use
  npm run agent:dev                Optional Eve research team (model access needed)

Use --demo with dashboard/status/report to read the isolated synthetic database.
No command enables live orders, deposits, or withdrawals.`);return;}
  if(command==='mcp'){if(args[1])print(await mcpRead(args[1],JSON.parse(args[2]??'{}')));else print(await mcpTools());return;}
  const fixture=command==='demo'||args.includes('--demo');
  const store=await Store.open({fixture,directory:fixture?resolve('data/demo'):process.env.DATA_DIR,url:fixture?undefined:process.env.DATABASE_URL});
  let persistent=false;
  try{
    if(command==='demo'){
      if(!(await store.markets()).length)print(await seedDemo(store));else print({message:'Existing isolated demo preserved. Use npm run dev -- --demo to inspect it.',state:await store.state()});
    }else if(command==='status')print(await status(store));
    else if(command==='dashboard'){const server=await dashboard(store,Number(process.env.PORT??4310));persistent=true;controller.signal.addEventListener('abort',()=>server.close(()=>void store.close()),{once:true});}
    else if(command==='collect'){const collector=new Collector(store);print(await collector.once());}
    else if(command==='stream')await streamBooks(store,controller.signal);
    else if(command==='export')print(await evaluationInput(store));
    else if(command==='report')print(await evaluate(store));
    else if(command==='pause'){await store.mutate(s=>{s.paused=true;s.pauseReason='Operator pause';});print(await tick(store,iso(),false));}
    else if(command==='resume'){
      const books=await store.books(),markets=await store.markets();
      await store.mutate(s=>{const now=iso(),current=equity(s,books,markets,now);applyLossLimits(s,current,now);if(POLICY.bankroll-current>=POLICY.cumulativeLoss||s.dayStartEquity-current>=POLICY.dailyLoss)throw new Error('Loss threshold still breached. Bankroll and baselines cannot be reset to bypass limits.');s.paused=false;s.halted=false;s.pauseReason=null;});print({resumed:true,mode:'paper'});
    }else if(command==='propose'){
      const evidence=await evaluate(store),id=`forecast-residual-${Date.now()}`;
      await store.mutate(s=>s.strategies.push({id,status:'candidate',createdAt:iso(),notes:'Candidate raises the minimum edge to 6 cents. Evidence describes the current strategy, not proof of candidate performance; forward-paper evaluation is still required.',parameters:{minimumEdge:0.06},evidence}));print({candidate:id,automaticPromotion:false,paperOnly:true});
    }else if(command==='approve'){
      if(!args[1])throw new Error('Supply the exact reviewed candidate ID');
      await store.mutate(s=>{const candidate=s.strategies.find(v=>v.id===args[1]&&v.status==='candidate');if(!candidate)throw new Error('Candidate not found');for(const previous of s.strategies)if(previous.status==='approved')previous.status='retired';candidate.status='approved';candidate.approvedAt=iso();s.activeStrategy=candidate.id;});print({approved:args[1],mode:'paper',liveEnabled:false});
    }else if(command==='paper'){
      if(fixture)throw new Error('Use demo separately; continuous paper must never mix fixtures with production observations');
      const server=await dashboard(store,Number(process.env.PORT??4310));
      try{
        await runPaper(store,controller.signal);
      }finally{await new Promise<void>(r=>server.close(()=>r()));}
    }else throw new Error(`Unknown command: ${command}. Use npm run swarm -- help.`);
  }finally{if(!persistent)await store.close();}
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
