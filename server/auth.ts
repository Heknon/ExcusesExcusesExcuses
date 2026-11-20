import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, type Pool } from './db.ts';
import type { User } from '../shared/types.ts';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'eee_session';
export const SESSION_DAYS = 60;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(input: { email?: unknown; password?: unknown; name?: unknown }, needName: boolean) {
  const email = String(input.email ?? '').trim().toLowerCase();
  const password = String(input.password ?? '');
  const name = String(input.name ?? '').trim();
  if (!EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address');
  if (needName && !name) throw new HttpError(400, 'Enter your name');
  if (needName && name.length > 40) throw new HttpError(400, 'Name is too long');
  if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  return { email, password, name };
}

/** Small in-memory brake on password guessing: 10 failures per email per 15 minutes. */
const failures = new Map<string, { count: number; until: number }>();
function checkThrottle(email: string) {
  const f = failures.get(email);
  if (f && f.until > Date.now() && f.count >= 10) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}
function recordFailure(email: string) {
  const f = failures.get(email);
  const fresh = !f || f.until < Date.now();
  failures.set(email, { count: fresh ? 1 : f.count + 1, until: fresh ? Date.now() + 15 * 60_000 : f.until });
}

const toUser = (r: any): User => ({ id: r.id, email: r.email, name: r.name });

export function authService(pool: Pool) {
  async function createSession(userId: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
      [sha256(token), userId, SESSION_DAYS],
    );
    return token;
  }

  return {
    async signup(input: { email?: unknown; password?: unknown; name?: unknown }) {
      const { email, password, name } = validate(input, true);
      const hash = await hashPassword(password);
      const { rows } = await pool
        .query('INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *', [email, name, hash])
        .catch((err) => {
          if (err?.code === '23505') throw new HttpError(409, 'An account with this email already exists');
          throw err;
        });
      const user = toUser(rows[0]);
      return { user, token: await createSession(user.id) };
    },

    async login(input: { email?: unknown; password?: unknown }) {
      const email = String(input.email ?? '').trim().toLowerCase();
      const password = String(input.password ?? '');
      checkThrottle(email);
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      const ok = rows[0] && (await verifyPassword(password, rows[0].password_hash));
      if (!ok) {
        recordFailure(email);
        throw new HttpError(401, 'Wrong email or password');
      }
      failures.delete(email);
      const user = toUser(rows[0]);
      return { user, token: await createSession(user.id) };
    },

    async logout(token: string) {
      await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
    },

    async userForToken(token: string | undefined): Promise<User | null> {
      if (!token) return null;
      const { rows } = await pool.query(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`,
        [sha256(token)],
      );
      return rows[0] ? toUser(rows[0]) : null;
    },

    async updateProfile(userId: number, input: { name?: unknown }) {
      const name = String(input.name ?? '').trim();
      if (!name || name.length > 40) throw new HttpError(400, 'Enter a name up to 40 characters');
      const { rows } = await pool.query('UPDATE users SET name = $2 WHERE id = $1 RETURNING *', [userId, name]);
      return toUser(rows[0]);
    },
  };
}

export type AuthService = ReturnType<typeof authService>;
