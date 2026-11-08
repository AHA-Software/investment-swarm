import { constants, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { z } from 'zod';
import { Store } from './db.js';
import { iso, USD, epoch, timestampSchema, type Book } from './domain.js';
import { normalizeLevels } from './kalshi.js';
import { parsePrice } from './math.js';

export function streamHeaders(keyId:string,privateKey:string,timestamp=String(Date.now())) {
  return {'KALSHI-ACCESS-KEY':keyId,'KALSHI-ACCESS-TIMESTAMP':timestamp,'KALSHI-ACCESS-SIGNATURE':sign('sha256',Buffer.from(timestamp+'GET/trade-api/ws/v2'),{key:privateKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:constants.RSA_PSS_SALTLEN_DIGEST}).toString('base64')};
}
// Sequence is subscription-wide, not per-market. Any gap invalidates ALL books.
export class BookStream {
  books=new Map<string,Book>();lastSeq:number|undefined;
  apply(input:unknown,receivedAt=iso()):{gap:boolean;book?:Book} {
    timestampSchema.parse(receivedAt);
    const e=z.object({type:z.string(),seq:z.number().int().optional(),msg:z.unknown().optional()}).passthrough().parse(input);
    if (!['orderbook_snapshot','orderbook_delta'].includes(e.type)) return {gap:false};
    if (e.seq===undefined) throw new Error('Missing order-book sequence');
    if (this.lastSeq!==undefined && e.seq!==this.lastSeq+1) { for(const b of this.books.values()) b.valid=false;this.lastSeq=undefined;return {gap:true}; }
    this.lastSeq=e.seq;
    const msg=z.object({market_ticker:z.string()}).passthrough().parse(e.msg);
    if(e.type==='orderbook_snapshot') {
      const yes=normalizeLevels(msg.yes_dollars_fp??msg.yes_dollars??[]),no=normalizeLevels(msg.no_dollars_fp??msg.no_dollars??[]);
      const book:Book={ticker:msg.market_ticker,receivedAt,yes,no,source:'websocket',valid:(yes[0]?.price??0)+(no[0]?.price??0)<USD};
      this.books.set(book.ticker,book);return {gap:false,book};
    }
    const d=z.object({side:z.enum(['yes','no']),price_dollars:z.string(),delta_fp:z.string()}).parse(msg);
    const book=this.books.get(msg.market_ticker);
    if(!book?.valid) return {gap:true};
    const price=parsePrice(d.price_dollars),delta=Number(d.delta_fp);
    if(!Number.isFinite(delta)) throw new Error('Malformed book delta');
    const level=book[d.side].find(l=>l.price===price);
    if(level) level.quantity+=delta;else book[d.side].push({price,quantity:delta});
    if(book[d.side].some(l=>l.quantity<0)) {book.valid=false;return {gap:true};}
    book[d.side]=book[d.side].filter(l=>l.quantity>0).sort((a,b)=>b.price-a.price);
    book.receivedAt=receivedAt;book.valid=(book.yes[0]?.price??0)+(book.no[0]?.price??0)<USD;
    return {gap:false,book};
  }
}
export async function streamBooks(store:Store,signal:AbortSignal) {
  const keyId=process.env.KALSHI_API_KEY_ID,path=process.env.KALSHI_PRIVATE_KEY_PATH;
  if(!keyId||!path) throw new Error('Streaming requires KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY_PATH; public REST collection works without them.');
  const key=await readFile(path,'utf8');
  while(!signal.aborted) {
    const tickers=(await store.markets()).filter(m=>['active','open'].includes(m.status)&&epoch(m.closeAt)>Date.now()).map(m=>m.ticker);
    await new Promise<void>(resolve=> {
      const ws=new WebSocket('wss://external-api-ws.kalshi.com/trade-api/ws/v2',{headers:streamHeaders(keyId,key),handshakeTimeout:15000});
      const state=new BookStream();let chain=Promise.resolve();let alive=true;
      const close=()=>ws.close();signal.addEventListener('abort',close,{once:true});
      const ping=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},15000);
      ws.on('pong',()=>{alive=true;});
      ws.on('open',()=>ws.send(JSON.stringify({id:1,cmd:'subscribe',params:{channels:['orderbook_delta'],market_tickers:tickers}})));
      ws.on('message',data=> {chain=chain.then(async()=>{
        const result=state.apply(JSON.parse(data.toString()));
        if(result.gap) {for(const b of state.books.values()) await store.save('book',b.ticker,{...b,valid:false});ws.close();return;}
        if(result.book) await store.save('book',result.book.ticker,result.book,result.book.receivedAt);
      }).catch(async e=>{await store.save('health','stream',{at:iso(),error:e instanceof Error?e.message:String(e)});ws.close();});});
      ws.on('error',()=>ws.close());
      ws.on('close',()=>{clearInterval(ping);signal.removeEventListener('abort',close);void chain.finally(resolve);});
    });
    if(!signal.aborted) await new Promise(r=>setTimeout(r,2000));
  }
}
