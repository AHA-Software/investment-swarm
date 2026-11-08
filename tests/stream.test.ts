import { describe,it,expect } from 'vitest';
import { BookStream } from '../src/stream.js';
import { NOW } from './fixtures.js';
describe('stream reconciliation',()=>{
  it('invalidates every market on a subscription sequence gap',()=>{const s=new BookStream();for(let i=1;i<=2;i++)s.apply({type:'orderbook_snapshot',seq:i,msg:{market_ticker:'M'+i,yes_dollars_fp:[['0.4','10']],no_dollars_fp:[['0.5','10']]}},NOW);expect(s.apply({type:'orderbook_delta',seq:4,msg:{market_ticker:'M1',side:'yes',price_dollars:'0.4',delta_fp:'2'}},NOW).gap).toBe(true);expect([...s.books.values()].every(b=>!b.valid)).toBe(true);});
  it('replaces snapshots and applies signed fixed-point deltas',()=>{const s=new BookStream();s.apply({type:'orderbook_snapshot',seq:1,msg:{market_ticker:'M',yes_dollars_fp:[['0.4','10']],no_dollars_fp:[]}},NOW);const r=s.apply({type:'orderbook_delta',seq:2,msg:{market_ticker:'M',side:'yes',price_dollars:'0.4',delta_fp:'-2.50'}},NOW);expect(r.book!.yes[0]!.quantity).toBe(7.5);});
  it('rejects malformed receipt timestamps',()=>{expect(()=>new BookStream().apply({type:'orderbook_snapshot',seq:1,msg:{}},'broken')).toThrow();});
});
