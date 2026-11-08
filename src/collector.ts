import { Store } from './db.js';
import { CITIES, epoch, iso, localDate, type City, type Forecast, type Market } from './domain.js';
import { KalshiData, normalizeMarket } from './kalshi.js';
import { WeatherData } from './weather.js';

export class Collector {
  constructor(private store: Store, private kalshi = new KalshiData(), private weather = new WeatherData()) {}
  async discover() {
    const errors: string[] = []; let count=0;
    for (const city of Object.keys(CITIES) as City[]) {
      try {
        const feeRate = await this.kalshi.feeRate(city);
        const raw = await this.kalshi.markets(city);
        const eventFees=new Map<string,number|null>();
        const today = localDate(iso(),CITIES[city].timezone), horizon = new Date(Date.now()+48*3_600_000).toISOString().slice(0,10);
        for (const item of raw) {
          const market = normalizeMarket(item,city,feeRate);
          if (market.date<today || market.date>horizon) continue;
          if(!eventFees.has(market.event))eventFees.set(market.event,await this.kalshi.eventFeeRate(market.event,feeRate));
          market.feeRate=eventFees.get(market.event)!;
          await this.store.save('raw-market',market.ticker,item);
          await this.store.save('market',market.ticker,market); count++;
        }
      } catch(e) { errors.push(`${city}: ${e instanceof Error?e.message:String(e)}`); }
    }
    await this.store.save('health','discovery',{at:iso(),count,errors});
    return {count,errors};
  }
  async weatherSnapshot() {
    const errors: string[]=[];let count=0;
    for (const city of Object.keys(CITIES) as City[]) {
      try {
        const {raw,forecasts} = await this.weather.forecast(city);
        await this.store.save('raw-forecast',city,raw);
        for (const f of forecasts) {
          // Do not overwrite the archived full-day, day-ahead forecast with a partial intraday forecast.
          await this.store.save('forecast-vintage',`${city}:${f.date}`,f,f.receivedAt);
          if (f.complete && localDate(f.receivedAt,CITIES[city].timezone)<f.date) await this.store.save('forecast',`${city}:${f.date}`,f,f.receivedAt);
        }
        await this.store.save('observations',city,await this.weather.observations(city)); count++;
      } catch(e) { errors.push(`${city}: ${e instanceof Error?e.message:String(e)}`); }
    }
    await this.store.save('health','weather',{at:iso(),count,errors}); return {count,errors};
  }
  async books() {
    const markets = (await this.store.markets()).filter(m=>['active','open'].includes(m.status) && epoch(m.closeAt)>Date.now());
    let count=0;const errors:string[]=[];
    for (const market of markets) {
      try { const book=await this.kalshi.book(market.ticker);await this.store.save('book',market.ticker,book,book.receivedAt);count++; }
      catch(e) { errors.push(`${market.ticker}: ${e instanceof Error?e.message:String(e)}`); }
    }
    await this.store.save('health','books',{at:iso(),count,errors});return {count,errors};
  }
  async settlements() {
    const markets = await this.store.markets(), now=iso();let count=0;
    const byEvent = new Map<string,Market[]>();
    for (const old of markets.filter(m=>epoch(m.closeAt)<=epoch(now))) {
      try {
        const market = await this.kalshi.market(old.ticker,old.city,old.feeRate);
        await this.store.save('market',market.ticker,market);
        if (market.status==='settled' && market.result) { byEvent.set(market.event,[...(byEvent.get(market.event)??[]),market]);count++; }
      } catch { /* Historical records may need an archive lookup; remain unresolved until fetched. */ }
    }
    for (const [event,settled] of byEvent) {
      const market = settled[0]!;
      const numericValues = settled.map(m=>m.expirationValue).filter(v=>v && /^-?\d+(\.\d+)?$/.test(v));
      const observedHigh = numericValues.length ? Number(numericValues[0]) : NaN;
      if (!Number.isFinite(observedHigh) || numericValues.some(v=>Number(v)!==observedHigh) || !market.rulesVerified) continue;
      const history = await this.store.history<Forecast>('forecast-vintage',`${market.city}:${market.date}`,now);
      // Pick the last full-day vintage received on the preceding LOCAL day, never revised data.
      const previous = new Date(`${market.date}T12:00:00Z`);previous.setUTCDate(previous.getUTCDate()-1);
      const previousDate=previous.toISOString().slice(0,10);
      const forecast = history.filter(f=>f.complete && localDate(f.receivedAt,CITIES[f.city].timezone)===previousDate).at(-1);
      if (!forecast) continue;
      await this.store.addSample({city:market.city,date:market.date,event,station:market.station,source:market.source,rulesHash:market.rulesHash,forecastHigh:forecast.highF,observedHigh,forecastPublishedAt:forecast.publishedAt,forecastReceivedAt:forecast.receivedAt,settledAt:now,horizon:'day-ahead'});
    }
    return {settled:count};
  }
  async once() { const discovery=await this.discover();const weather=await this.weatherSnapshot();const books=await this.books();const settlements=await this.settlements();return {discovery,weather,books,settlements}; }
}
