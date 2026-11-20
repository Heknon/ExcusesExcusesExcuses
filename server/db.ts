import pg from 'pg';
import { ERRORS, type ErrorCode } from '../shared/errors.ts';

const SCHEMA = `
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
    status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'live', 'final')),
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
`;

// DATE columns as plain 'YYYY-MM-DD' strings, never JS Dates (no timezone shifts).
pg.types.setTypeParser(pg.types.builtins.DATE, (v) => v);

export type Pool = pg.Pool;
export type Client = pg.PoolClient;
export type Queryable = Pick<pg.Pool | pg.PoolClient, 'query'>;

export async function openPool(connectionString: string): Promise<pg.Pool> {
  const pool = new pg.Pool({ connectionString, max: 10 });
  pool.on('error', (err) => console.error('postgres pool error', err));
  await pool.query(SCHEMA);
  return pool;
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
