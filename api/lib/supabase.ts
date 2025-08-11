import 'dotenv/config';
import { Pool } from 'pg';

// If you still have SUPABASE_URL + keys, the old client can be used.
// For direct Postgres access, set SUPABASE_PG_URL (pooled URL preferred) and we use a
// minimal compatibility shim that supports the subset of methods used in this app.

const PG_URL = process.env.SUPABASE_PG_URL || process.env.SUPABASE_ALT_URL;

type EqCond = { column: string; value: any };

class Thenable<T> implements PromiseLike<T> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled as any, onrejected as any);
  }
  // To be implemented by subclasses
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  // @ts-ignore
  protected execute(): Promise<T> { return Promise.resolve(undefined as any); }
}

class SelectBuilder extends Thenable<{ data: any[] | any | null }> {
  constructor(
    private pool: Pool,
    private table: string,
    private columns: string,
  ) { super(); }

  private wheres: EqCond[] = [];
  private orderBy: { column: string; asc: boolean } | null = null;
  private limitCount: number | null = null;
  private singleFlag: 'single' | 'maybe' | null = null;

  eq(column: string, value: any): this { this.wheres.push({ column, value }); return this; }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.orderBy = { column, asc: opts?.ascending !== false };
    return this;
  }
  limit(n: number): this { this.limitCount = n; return this; }
  single(): Promise<{ data: any }> { this.singleFlag = 'single'; return this.execute(); }
  maybeSingle(): Promise<{ data: any | null }> { this.singleFlag = 'maybe'; return this.execute(); }

  protected async execute(): Promise<{ data: any[] | any | null }> {
    const params: any[] = [];
    const whereSql = this.wheres
      .map((w, idx) => {
        params.push(w.value);
        return `${w.column} = $${params.length}`;
      })
      .join(' AND ');
    const whereClause = whereSql ? `WHERE ${whereSql}` : '';
    const order = this.orderBy ? `ORDER BY ${this.orderBy.column} ${this.orderBy.asc ? 'ASC' : 'DESC'}` : '';
    const limit = this.limitCount ? `LIMIT ${this.limitCount}` : '';
    const sql = `SELECT ${this.columns} FROM ${this.table} ${whereClause} ${order} ${limit}`;
    const { rows } = await this.pool.query(sql, params);
    if (this.singleFlag === 'single') return { data: rows[0] };
    if (this.singleFlag === 'maybe') return { data: rows[0] ?? null };
    return { data: rows };
  }
}

class UpdateBuilder extends Thenable<{ error?: any }> {
  constructor(
    private pool: Pool,
    private table: string,
    private payload: Record<string, any>,
  ) { super(); }
  private wheres: EqCond[] = [];
  eq(column: string, value: any): this { this.wheres.push({ column, value }); return this; }
  protected async execute(): Promise<{ error?: any }> {
    const sets: string[] = [];
    const params: any[] = [];
    Object.entries(this.payload).forEach(([k, v]) => {
      if (v === undefined) return; // skip undefined fields like optional snapshots
      params.push(v);
      sets.push(`${k} = $${params.length}`);
    });
    const whereSql = this.wheres
      .map((w) => { params.push(w.value); return `${w.column} = $${params.length}`; })
      .join(' AND ');
    const sql = `UPDATE ${this.table} SET ${sets.join(', ')} ${whereSql ? 'WHERE ' + whereSql : ''}`;
    await this.pool.query(sql, params);
    return {};
  }
}

class InsertBuilder extends Thenable<{ error?: any }> {
  constructor(
    private pool: Pool,
    private table: string,
    private rows: Record<string, any>[],
    private conflictCols: string[] | null,
  ) { super(); }
  protected async execute(): Promise<{ error?: any }> {
    if (!this.rows.length) return {};
    const cols = Array.from(new Set(this.rows.flatMap((r) => Object.keys(r).filter((k) => this.rows.some(rr => rr[k] !== undefined)) )));
    const params: any[] = [];
    const valuesSql = this.rows
      .map((r) => {
        const placeholders = cols.map((c) => {
          params.push(r[c]);
          return `$${params.length}`;
        });
        return `(${placeholders.join(', ')})`;
      })
      .join(', ');
    let sql = `INSERT INTO ${this.table} (${cols.join(', ')}) VALUES ${valuesSql}`;
    if (this.conflictCols && this.conflictCols.length) {
      const updates = cols.filter((c) => !this.conflictCols!.includes(c)).map((c) => `${c} = EXCLUDED.${c}`);
      if (updates.length) sql += ` ON CONFLICT (${this.conflictCols.join(', ')}) DO UPDATE SET ${updates.join(', ')}`;
      else sql += ` ON CONFLICT (${this.conflictCols.join(', ')}) DO NOTHING`;
    }
    await this.pool.query(sql, params);
    return {};
  }
}

class DeleteBuilder extends Thenable<{ error?: any }> {
  constructor(private pool: Pool, private table: string) { super(); }
  private wheres: EqCond[] = [];
  eq(column: string, value: any): this { this.wheres.push({ column, value }); return this; }
  protected async execute(): Promise<{ error?: any }> {
    const params: any[] = [];
    const whereSql = this.wheres
      .map((w) => { params.push(w.value); return `${w.column} = $${params.length}`; })
      .join(' AND ');
    const sql = `DELETE FROM ${this.table} ${whereSql ? 'WHERE ' + whereSql : ''}`;
    await this.pool.query(sql, params);
    return {};
  }
}

function conflictColsFor(table: string): string[] | null {
  switch (table) {
    case 'wrap_guilds': return ['guild_id'];
    case 'user_tracks': return ['guild_id', 'user_id'];
    case 'history': return ['guild_id', 'user_id', 'posted_at'];
    default: return null; // fall back to plain INSERT
  }
}

function buildShim(pool: Pool) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          return new SelectBuilder(pool, table, columns);
        },
        update(payload: Record<string, any>) {
          return new UpdateBuilder(pool, table, payload);
        },
        upsert(rowOrRows: Record<string, any> | Record<string, any>[]) {
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
          return new InsertBuilder(pool, table, rows, conflictColsFor(table));
        },
        delete() {
          return new DeleteBuilder(pool, table);
        },
      } as any;
    },
    // Minimal stub for realtime API used by subscribeWrapGuilds; no-op for direct PG
    channel(_name: string) {
      const api = {
        on() { return api; },
        subscribe() { return { unsubscribe() { /* no-op */ } }; },
      } as any;
      return api;
    },
  } as const;
}

export const supabase = (() => {
  if (PG_URL) {
    const pool = new Pool({ connectionString: PG_URL, ssl: { rejectUnauthorized: false }, max: 10, idleTimeoutMillis: 5_000 });
    return buildShim(pool);
  }
  // Fallback: throw to indicate missing configuration
  throw new Error('SUPABASE_PG_URL (or SUPABASE_ALT_URL) not set. Configure a Postgres connection string.');
})();
