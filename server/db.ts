import pg from 'pg';
import { ERRORS, type ErrorCode } from '../shared/errors.ts';

/**
 * Schema changes, applied in order and recorded in schema_migrations. Each runs before the code that
 * needs it goes live, so it must keep the previous version working. Never edit one that has shipped.
 */
export const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: '001_initial',
    sql: `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    invite_code TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS players (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('admin', 'player')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'removed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    start_date DATE NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'goals' CHECK (status IN ('goals', 'bets', 'live', 'final')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (game_id, start_date)
  );

  CREATE TABLE IF NOT EXISTS round_entries (
    round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    goal TEXT NOT NULL DEFAULT '',
    outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'done', 'partial', 'failed')),
    excuse TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    excuse_pick_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    excuse_reason TEXT NOT NULL DEFAULT '',
    bet_pick_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
    bet_reason TEXT NOT NULL DEFAULT '',
    submitted_at TIMESTAMPTZ,
    PRIMARY KEY (round_id, player_id)
  );

  -- Photos a player attaches as proof for a round. Re-encoded client-side; magic bytes checked server-side.
  CREATE TABLE IF NOT EXISTS proofs (
    id SERIAL PRIMARY KEY,
    round_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    mime TEXT NOT NULL,
    bytes BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (round_id, player_id) REFERENCES round_entries(round_id, player_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS proofs_entry ON proofs(round_id, player_id);

  ALTER TABLE users ADD COLUMN IF NOT EXISTS locale TEXT;

  -- Round deadlines. Rounds from before deadlines existed get the end of their week.
  ALTER TABLE rounds ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ;
  UPDATE rounds SET deadline = (start_date + 7)::timestamptz - interval '1 minute' WHERE deadline IS NULL;

  -- Several goals per entry, each with its own result.
  CREATE TABLE IF NOT EXISTS entry_goals (
    id SERIAL PRIMARY KEY,
    round_id INTEGER NOT NULL,
    player_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'done', 'partial', 'failed')),
    FOREIGN KEY (round_id, player_id) REFERENCES round_entries(round_id, player_id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS entry_goals_entry ON entry_goals(round_id, player_id, position);

  -- Move single goals from before multi-goal support into entry_goals (once: the old column is cleared).
  WITH moved AS (
    INSERT INTO entry_goals (round_id, player_id, position, text, outcome)
    SELECT round_id, player_id, 0, goal, outcome FROM round_entries WHERE goal <> ''
    RETURNING round_id, player_id
  )
  UPDATE round_entries e SET goal = '' FROM moved m WHERE e.round_id = m.round_id AND e.player_id = m.player_id;

  -- Rounds split 'planning' into 'goals' then 'bets'. Rounds still in planning go back to goals.
  ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_status_check;
  UPDATE rounds SET status = 'goals' WHERE status = 'planning';
  ALTER TABLE rounds ADD CONSTRAINT rounds_status_check CHECK (status IN ('goals', 'bets', 'live', 'final'));
  ALTER TABLE rounds ALTER COLUMN status SET DEFAULT 'goals';

  -- Each player's secret vote for the most impressive week.
  ALTER TABLE round_entries ADD COLUMN IF NOT EXISTS mvp_vote_id INTEGER REFERENCES players(id) ON DELETE SET NULL;
`,
  },
  {
    // Accounts sign in with Google; existing accounts are matched by email and keep their history.
    id: '002_google_sign_in',
    sql: `ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;`,
  },
  {
    // Proof photos move to object storage. Rows keep their bytes until scripts/move-proofs-to-s3.ts runs.
    id: '003_proofs_in_s3',
    sql: `
      ALTER TABLE proofs ADD COLUMN object_key TEXT UNIQUE;
      ALTER TABLE proofs ALTER COLUMN bytes DROP NOT NULL;
      ALTER TABLE proofs ADD CONSTRAINT proofs_stored CHECK (bytes IS NOT NULL OR object_key IS NOT NULL);
    `,
  },
];

// DATE columns as plain 'YYYY-MM-DD' strings, never JS Dates (no timezone shifts).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export function openPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', (err) => console.error('postgres pool error', err));
  return pool;
}

const MIGRATION_LOCK = 4_242_001;

/** Apply pending migrations. Safe to run on every deploy, and concurrently: an advisory lock serialises runs. */
export async function migrate(connectionString: string): Promise<string[]> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ id: string }>('SELECT id FROM schema_migrations');
    const done = new Set(rows.map((r) => r.id));
    const applied: string[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [m.id]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      applied.push(m.id);
    }
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    await client.end();
  }
}

export async function transaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
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
}

export class HttpError extends Error {
  status: number;
  code: ErrorCode;
  constructor(status: number, code: ErrorCode) {
    super(ERRORS[code]);
    this.status = status;
    this.code = code;
  }
}

/** Map Postgres constraint errors to client errors. */
export function friendly(err: any): never {
  if (err instanceof HttpError) throw err;
  if (err?.code === '23505') throw new HttpError(409, 'already_exists');
  if (err?.code === '23503') throw new HttpError(400, 'unknown_reference');
  if (err?.code === '22007' || err?.code === '22008') throw new HttpError(400, 'invalid_date');
  throw err;
}
