import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CITIES, epoch, initialState, iso, localDate, priorDate, validTime, weatherEvent, type State, type Market, type Book, type Forecast, type TrainingSample } from './domain.js';

interface Query { query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }> }
interface Database extends Query { transaction<T>(fn: (tx: Query) => Promise<T>): Promise<T>; close(): Promise<void> }
export class Store {
  constructor(private db: Database) {}
  static async open(options: { directory?: string; url?: string; fixture?: boolean } = {}) {
    let db: Database;
    if (options.url) {
      const pool = new pg.Pool({ connectionString: options.url, max: 5 });
      db = { query: (s, p) => pool.query(s, p), close: () => pool.end(), transaction: async fn => {
        const c = await pool.connect();
        try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
        catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
      } };
    } else {
      const directory = options.directory ?? resolve('data/paper');
      if (directory !== 'memory://') await mkdir(directory, { recursive: true });
      const pglite = new PGlite(directory === 'memory://' ? undefined : directory);
      db = { query: (s, p) => pglite.query(s, p), close: () => pglite.close(), transaction: fn => pglite.transaction(tx => fn(tx)) };
    }
    const store = new Store(db);
    await db.query(`CREATE TABLE IF NOT EXISTS swarm_state (id integer PRIMARY KEY CHECK (id=1), data jsonb NOT NULL)`);
    await db.query(`CREATE TABLE IF NOT EXISTS snapshots (id bigserial PRIMARY KEY, kind text NOT NULL, key text NOT NULL, received_at timestamptz NOT NULL, payload jsonb NOT NULL)`);
    await db.query(`CREATE INDEX IF NOT EXISTS snapshots_lookup ON snapshots(kind,key,received_at DESC,id DESC)`);
    await db.query(`CREATE TABLE IF NOT EXISTS samples (city text NOT NULL,date text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(city,date))`);
    await db.query(`CREATE TABLE IF NOT EXISTS audit_log (id text PRIMARY KEY,kind text NOT NULL,at timestamptz NOT NULL,payload jsonb NOT NULL)`);
    await db.query(`INSERT INTO swarm_state VALUES(1,$1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(initialState(iso(), options.fixture))]);
    return store;
  }
  close() { return this.db.close(); }
  async state(): Promise<State> { const r = await this.db.query('SELECT data FROM swarm_state WHERE id=1'); return r.rows[0]!.data as State; }
  async mutate<T>(fn: (state: State) => T | Promise<T>): Promise<T> {
    return this.db.transaction(async tx => {
      const r = await tx.query('SELECT data FROM swarm_state WHERE id=1 FOR UPDATE');
      const state = structuredClone(r.rows[0]!.data as State);
      const decisions = new Set(state.decisions.map(d=>d.id)), fills = new Set(state.fills.map(f=>f.id));
      const lastEquityTime = state.equityHistory.at(-1)?.timestamp;
      const result = await fn(state);
      for (const d of state.decisions.filter(d=>!decisions.has(d.id))) await tx.query('INSERT INTO audit_log VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[d.id,'decision',d.timestamp,JSON.stringify(d)]);
      for (const f of state.fills.filter(f=>!fills.has(f.id))) await tx.query('INSERT INTO audit_log VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[f.id,'fill',f.timestamp,JSON.stringify(f)]);
      for (const e of state.equityHistory.filter(e=>!lastEquityTime || epoch(e.timestamp)>epoch(lastEquityTime))) await tx.query('INSERT INTO audit_log VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING',[`equity-${new Date(epoch(e.timestamp)).toISOString()}`,'equity',e.timestamp,JSON.stringify(e)]);
      state.decisions = state.decisions.slice(-300); state.fills = state.fills.slice(-300); state.equityHistory = state.equityHistory.slice(-1000);
      await tx.query('UPDATE swarm_state SET data=$1::jsonb WHERE id=1', [JSON.stringify(state)]);
      return result;
    });
  }
  async save(kind: string, key: string, payload: unknown, receivedAt = iso()) {
    if (!validTime(receivedAt)) throw new Error('Invalid snapshot timestamp');
    await this.db.query('INSERT INTO snapshots(kind,key,received_at,payload) VALUES($1,$2,$3,$4::jsonb)', [kind, key, receivedAt, JSON.stringify(payload)]);
  }
  async latest<T>(kind: string): Promise<T[]> {
    const r = await this.db.query('SELECT DISTINCT ON (key) payload FROM snapshots WHERE kind=$1 ORDER BY key,received_at DESC,id DESC', [kind]);
    return r.rows.map(r => r.payload as T);
  }
  async history<T>(kind: string, key: string, before: string): Promise<T[]> {
    const r = await this.db.query('SELECT payload FROM snapshots WHERE kind=$1 AND key=$2 AND received_at <= $3 ORDER BY received_at,id', [kind, key, before]);
    return r.rows.map(r => r.payload as T);
  }
  async addSample(sample: TrainingSample) {
    if (!CITIES[sample.city] || !sample.source || !sample.rulesHash || sample.station!==CITIES[sample.city].climateStation || sample.event!==weatherEvent(sample.city,sample.date)) throw new Error('Training sample does not match approved contract metadata');
    if (![sample.forecastReceivedAt,sample.forecastPublishedAt,sample.settledAt].every(validTime)) throw new Error('Invalid training timestamp');
    if (localDate(sample.forecastReceivedAt,CITIES[sample.city].timezone)!==priorDate(sample.date) || localDate(sample.forecastPublishedAt,CITIES[sample.city].timezone)>=sample.date) throw new Error('Training forecast is not a day-ahead vintage');
    if (![sample.forecastHigh, sample.observedHigh].every(Number.isFinite)) throw new Error('Invalid training temperatures');
    if (epoch(sample.forecastReceivedAt) >= epoch(sample.settledAt) || epoch(sample.forecastPublishedAt) > epoch(sample.forecastReceivedAt)) throw new Error('Training sample contains future information');
    await this.db.query('INSERT INTO samples VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING', [sample.city, sample.date, JSON.stringify(sample)]);
  }
  async samples(): Promise<TrainingSample[]> { const r = await this.db.query('SELECT payload FROM samples ORDER BY date,city'); return r.rows.map(r => r.payload as TrainingSample); }
  async audit<T>(kind: string): Promise<T[]> { const r = await this.db.query('SELECT payload FROM audit_log WHERE kind=$1 ORDER BY at,id',[kind]); return r.rows.map(r=>r.payload as T); }
  markets() { return this.latest<Market>('market'); }
  books() { return this.latest<Book>('book'); }
  forecasts() { return this.latest<Forecast>('forecast'); }
}
