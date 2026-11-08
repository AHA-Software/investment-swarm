import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from './db.js';
import { equity } from './engine.js';
import { POLICY, CITIES, iso } from './domain.js';

export async function status(store:Store) {
  const [state,markets,books,forecasts,samples,health]=await Promise.all([store.state(),store.markets(),store.books(),store.forecasts(),store.samples(),store.health()]);
  return {at:iso(),state,policy:POLICY,cities:CITIES,markets,books,forecasts,health,
    samples:Object.keys(CITIES).map(city=>({city,count:samples.filter(s=>s.city===city&&(state.fixture||!s.fixture)).length})),
    equity:equity(state,books,markets),liveEnabled:false};
}
export async function dashboard(store:Store,port=4310) {
  const assets:Record<string,{file:string;type:string}>={
    '/':{file:'index.html',type:'text/html'},'/app.js':{file:'app.js',type:'text/javascript'},'/style.css':{file:'style.css',type:'text/css'},'/favicon.svg':{file:'favicon.svg',type:'image/svg+xml'},
  };
  const server=createServer(async(req,res)=>{
    try {
      const host=req.headers.host??'',address=server.address(),boundPort=address&&typeof address==='object'?address.port:port;
      if(![`127.0.0.1:${boundPort}`,`localhost:${boundPort}`].includes(host)) {res.writeHead(403);res.end('Local access only');return;}
      res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      if(req.method!=='GET') {res.writeHead(405);res.end('Read-only dashboard');return;}
      const path=new URL(req.url??'/','http://localhost').pathname;
      if(path==='/api/status') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await status(store)));return;}
      if(path==='/health') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,mode:'paper'}));return;}
      const asset=assets[path];if(!asset){res.writeHead(404);res.end('Not found');return;}
      res.setHeader('Content-Type',asset.type+'; charset=utf-8');res.end(await readFile(fileURLToPath(new URL(`../public/${asset.file}`,import.meta.url))));
    }catch(error){console.error(error instanceof Error?error.message:String(error));res.writeHead(500);res.end('Unable to read local paper state');}
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const address=server.address();console.log(`Paper dashboard: http://127.0.0.1:${address&&typeof address==='object'?address.port:port}`);
  return server;
}
