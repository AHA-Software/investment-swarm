import { z } from 'zod';
import { CITIES, iso, localDate, timestampSchema, type City, type Forecast } from './domain.js';
import { getJson } from './kalshi.js';

const periodSchema = z.object({ startTime: timestampSchema, endTime: timestampSchema, temperature: z.number().finite(), temperatureUnit: z.enum(['F','C']) });
export function normalizeForecast(raw: unknown, city: City, receivedAt = iso()): Forecast[] {
  timestampSchema.parse(receivedAt);
  const p = z.object({ properties: z.object({ updateTime: timestampSchema, periods: z.array(periodSchema) }) }).parse(raw).properties;
  if (Date.parse(p.updateTime) > Date.parse(receivedAt)) throw new Error('Forecast published in the future');
  const byDate = new Map<string, z.infer<typeof periodSchema>[]>();
  for (const period of p.periods) {
    const date = localDate(period.startTime, CITIES[city].timezone);
    byDate.set(date, [...(byDate.get(date) ?? []), period]);
  }
  return [...byDate].map(([date, periods]) => {
    const sorted = periods.sort((a,b) => Date.parse(a.startTime)-Date.parse(b.startTime));
    const hour = (t: string) => Number(new Intl.DateTimeFormat('en-US', { timeZone: CITIES[city].timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(t)));
    const complete = sorted.length >= 23 && hour(sorted[0]!.startTime) === 0 && hour(sorted.at(-1)!.startTime) === 23 && sorted.every((v,i) => !i || Date.parse(v.startTime) === Date.parse(sorted[i-1]!.endTime));
    return { city, date, highF: Math.max(...periods.map(v => v.temperatureUnit === 'C' ? v.temperature*9/5+32 : v.temperature)), publishedAt: p.updateTime, receivedAt, periods: periods.length, complete };
  });
}
export class WeatherData {
  private urls = new Map<City, string>();
  async forecast(city: City) {
    if (!this.urls.has(city)) {
      const c = CITIES[city];
      const point = z.object({ properties: z.object({ forecastHourly: z.string().url() }) }).parse(await getJson(`https://api.weather.gov/points/${c.lat},${c.lon}`));
      if (new URL(point.properties.forecastHourly).hostname !== 'api.weather.gov') throw new Error('Unexpected forecast host');
      this.urls.set(city, point.properties.forecastHourly);
    }
    const raw = await getJson(this.urls.get(city)!);
    return { raw, forecasts: normalizeForecast(raw, city) };
  }
  async observations(city: City) {
    return getJson(`https://api.weather.gov/stations/${CITIES[city].station}/observations?limit=48`);
  }
}
