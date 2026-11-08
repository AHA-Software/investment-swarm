import { Store } from './db.js';
import { tick } from './engine.js';
import { CITIES, dollar, weatherEvent, type Market, type Book, type Forecast, type TrainingSample } from './domain.js';

export async function seedDemo(store:Store,now='2026-11-08T18:00:00.000Z') {
  if (!(await store.state()).fixture) throw new Error('Fixture data may only be loaded into a dedicated demo database');
  for (let i=0;i<40;i++) {
    const day=new Date(Date.parse(now)-(i+2)*86400000).toISOString().slice(0,10);
    const before=new Date(Date.parse(`${day}T18:00:00Z`)-86400000).toISOString();
    const s:TrainingSample={city:'nyc',date:day,station:CITIES.nyc.climateStation,event:weatherEvent('nyc',day),source:'The Weather Company',rulesHash:'demo-only',forecastHigh:65,observedHigh:65+[-2,-1,0,1,2][i%5]!,forecastPublishedAt:before,forecastReceivedAt:before,settledAt:`${day}T23:00:00.000Z`,horizon:'day-ahead',fixture:true};
    await store.addSample(s);
  }
  const market:Market={ticker:'DEMO-NYC-26NOV09-B65',event:'DEMO-NYC-26NOV09',city:'nyc',date:'2026-11-09',title:'Demo: NYC high temperature 64–67°F',closeAt:'2026-11-10T04:59:00.000Z',status:'active',rules:'Synthetic fixture. Never use as market evidence.',rulesHash:'demo-only',source:'The Weather Company',station:CITIES.nyc.climateStation,lower:64,upper:67,rulesVerified:true,feeRate:0.07};
  const forecast:Forecast={city:'nyc',date:market.date,highF:65,publishedAt:now,receivedAt:now,periods:24,complete:true};
  const book:Book={ticker:market.ticker,receivedAt:now,yes:[{price:dollar(0.36),quantity:30}],no:[{price:dollar(0.60),quantity:30}],source:'fixture',valid:true};
  await store.save('market',market.ticker,market,now);await store.save('forecast','nyc:'+market.date,forecast,now);await store.save('book',market.ticker,book,now);
  const entry=await tick(store,now);
  const later=new Date(Date.parse(now)+1000).toISOString();
  await store.save('book',market.ticker,{...book,receivedAt:later,yes:[{price:dollar(0.25),quantity:3}]},later);
  const partial=await tick(store,later);
  const finalTime=new Date(Date.parse(now)+2000).toISOString();
  await store.save('book',market.ticker,{...book,receivedAt:finalTime,yes:[],no:book.no},finalTime);
  const pending=await tick(store,finalTime);
  return {fixture:true,description:'Synthetic entry, partial stop-loss fill, then unavailable exit liquidity. No real orders.',entry,partial,pending};
}
