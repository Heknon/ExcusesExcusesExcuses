import pg from 'pg';
import type { AppState, Entry, EntryPatch, Member, Outcome, Week } from '../shared/types.ts';

const OUTCOMES: Outcome[] = ['pending', 'done', 'partial', 'failed'];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS members (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE
  );
  CREATE TABLE IF NOT EXISTS weeks (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    start_date DATE NOT NULL,
    closed BOOLEAN NOT NULL DEFAULT FALSE
  );
  CREATE TABLE IF NOT EXISTS entries (
    week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    goal TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'done', 'partial', 'failed')),
    excuse TEXT NOT NULL DEFAULT '',
    excuse_pick_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    excuse_reason TEXT NOT NULL DEFAULT '',
    bet_pick_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
    bet_reason TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (week_id, member_id)
  );
`;

// Return DATE columns as plain 'YYYY-MM-DD' strings, never as JS Dates (no timezone shifts).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

const toMember = (r: any): Member => ({ id: r.id, name: r.name, active: r.active });
const toWeek = (r: any): Week => ({ id: r.id, title: r.title, startDate: r.start_date, closed: r.closed });
const toEntry = (r: any): Entry => ({
  weekId: r.week_id,
  memberId: r.member_id,
  goal: r.goal,
  outcome: r.outcome,
  excuse: r.excuse,
  excusePickId: r.excuse_pick_id,
  excuseReason: r.excuse_reason,
  betPickId: r.bet_pick_id,
  betReason: r.bet_reason,
});

const ENTRY_COLUMNS: Record<keyof EntryPatch, string> = {
  goal: 'goal',
  outcome: 'outcome',
  excuse: 'excuse',
  excusePickId: 'excuse_pick_id',
  excuseReason: 'excuse_reason',
  betPickId: 'bet_pick_id',
  betReason: 'bet_reason',
};

/** Turn Postgres constraint errors into friendly 4xx responses. */
function friendly(err: any): never {
  if (err?.code === '23505') throw new HttpError(409, 'השם הזה כבר קיים');
  if (err?.code === '23503') throw new HttpError(400, 'חבר או שבוע לא קיים');
  if (err?.code === '22007' || err?.code === '22008') throw new HttpError(400, 'תאריך לא תקין');
  throw err;
}

async function upsertEntry(q: Queryable, weekId: number, memberId: number, patch: EntryPatch) {
  const sets: string[] = [];
  const values: unknown[] = [weekId, memberId];
  for (const [key, col] of Object.entries(ENTRY_COLUMNS) as [keyof EntryPatch, string][]) {
    if (!(key in patch)) continue;
    let value = patch[key] as any;
    if (key === 'outcome' && !OUTCOMES.includes(value)) throw new HttpError(400, 'Bad outcome');
    if (key === 'excusePickId' || key === 'betPickId') value = value == null ? null : Number(value);
    else value = String(value ?? '').trim();
    values.push(value);
    sets.push(`${col} = $${values.length}`);
  }
  await q.query('INSERT INTO entries (week_id, member_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [weekId, memberId]);
  if (sets.length) {
    await q.query(`UPDATE entries SET ${sets.join(', ')} WHERE week_id = $1 AND member_id = $2`, values);
  }
}

export async function openDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5 });
  pool.on('error', (err) => console.error('postgres pool error', err));
  await pool.query(SCHEMA);

  const tx = async <T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (err) {
      await c.query('ROLLBACK');
      throw err;
    } finally {
      c.release();
    }
  };

  const api = {
    pool,

    async state(): Promise<AppState> {
      const [members, weeks, entries] = await Promise.all([
        pool.query('SELECT * FROM members ORDER BY id'),
        pool.query('SELECT * FROM weeks ORDER BY start_date DESC, id DESC'),
        pool.query('SELECT * FROM entries ORDER BY week_id, member_id'),
      ]);
      return {
        members: members.rows.map(toMember),
        weeks: weeks.rows.map(toWeek),
        entries: entries.rows.map(toEntry),
      };
    },

    async addMember(name: string): Promise<Member> {
      const clean = name.trim();
      if (!clean) throw new HttpError(400, 'Name is required');
      const { rows } = await pool.query(
        `INSERT INTO members (name) VALUES ($1)
         ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
         RETURNING *`,
        [clean],
      );
      return toMember(rows[0]);
    },

    async updateMember(id: number, patch: { name?: string; active?: boolean }) {
      if (patch.name !== undefined && !patch.name.trim()) throw new HttpError(400, 'Name is required');
      await pool
        .query(
          `UPDATE members SET name = COALESCE($2, name), active = COALESCE($3, active) WHERE id = $1`,
          [id, patch.name?.trim() ?? null, patch.active ?? null],
        )
        .catch(friendly);
    },

    async deleteMember(id: number) {
      await pool.query('DELETE FROM members WHERE id = $1', [id]);
    },

    async addWeek(input: { title?: string; startDate: string; entries?: (EntryPatch & { memberId: number })[] }): Promise<Week> {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate ?? '')) throw new HttpError(400, 'startDate must be YYYY-MM-DD');
      return tx(async (c) => {
        const { rows } = await c
          .query('INSERT INTO weeks (title, start_date) VALUES ($1, $2) RETURNING *', [input.title?.trim() ?? '', input.startDate])
          .catch(friendly);
        const week = toWeek(rows[0]);
        const entries =
          input.entries ??
          (await c.query('SELECT id AS "memberId" FROM members WHERE active ORDER BY id')).rows;
        for (const { memberId, ...patch } of entries) {
          await upsertEntry(c, week.id, Number(memberId), patch).catch(friendly);
        }
        return week;
      });
    },

    async updateWeek(id: number, patch: { title?: string; startDate?: string; closed?: boolean }) {
      await pool
        .query(
          `UPDATE weeks SET title = COALESCE($2, title), start_date = COALESCE($3::date, start_date),
             closed = COALESCE($4, closed) WHERE id = $1`,
          [id, patch.title?.trim() ?? null, patch.startDate ?? null, patch.closed ?? null],
        )
        .catch(friendly);
    },

    async deleteWeek(id: number) {
      await pool.query('DELETE FROM weeks WHERE id = $1', [id]);
    },

    async updateEntry(weekId: number, memberId: number, patch: EntryPatch) {
      await upsertEntry(pool, weekId, memberId, patch).catch(friendly);
    },

    async removeEntry(weekId: number, memberId: number) {
      await pool.query('DELETE FROM entries WHERE week_id = $1 AND member_id = $2', [weekId, memberId]);
    },

    close: () => pool.end(),
  };
  return api;
}

export type Db = Awaited<ReturnType<typeof openDb>>;
