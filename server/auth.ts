import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, type Pool } from './db.ts';
import { LOCALES, type Locale, type User } from '../shared/types.ts';

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
  if (!EMAIL.test(email)) throw new HttpError(400, 'invalid_email');
  if (needName && !name) throw new HttpError(400, 'name_required');
  if (needName && name.length > 40) throw new HttpError(400, 'name_too_long');
  if (password.length < 8) throw new HttpError(400, 'password_too_short');
  return { email, password, name };
}

/** Small in-memory brake on password guessing: 10 failures per email per 15 minutes. */
const failures = new Map<string, { count: number; until: number }>();
function checkThrottle(email: string) {
  const f = failures.get(email);
  if (f && f.until > Date.now() && f.count >= 10) throw new HttpError(429, 'too_many_attempts');
}
function recordFailure(email: string) {
  const f = failures.get(email);
  const fresh = !f || f.until < Date.now();
  failures.set(email, { count: fresh ? 1 : f.count + 1, until: fresh ? Date.now() + 15 * 60_000 : f.until });
}

const toUser = (r: any): User => ({ id: r.id, email: r.email, name: r.name, locale: r.locale ?? null });

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
    async signup(input: { email?: unknown; password?: unknown; name?: unknown; locale?: unknown }) {
      const { email, password, name } = validate(input, true);
      const locale = LOCALES.includes(input.locale as Locale) ? (input.locale as Locale) : null;
      const hash = await hashPassword(password);
      const { rows } = await pool
        .query('INSERT INTO users (email, name, password_hash, locale) VALUES ($1, $2, $3, $4) RETURNING *', [email, name, hash, locale])
        .catch((err) => {
          if (err?.code === '23505') throw new HttpError(409, 'email_taken');
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
        throw new HttpError(401, 'wrong_credentials');
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

    async updateProfile(userId: number, input: { name?: unknown; locale?: unknown }) {
      let name: string | null = null;
      if (input.name !== undefined) {
        name = String(input.name ?? '').trim();
        if (!name) throw new HttpError(400, 'name_required');
        if (name.length > 40) throw new HttpError(400, 'name_too_long');
      }
      if (input.locale !== undefined && !LOCALES.includes(input.locale as Locale)) throw new HttpError(400, 'invalid_locale');
      const { rows } = await pool.query(
        'UPDATE users SET name = COALESCE($2, name), locale = COALESCE($3, locale) WHERE id = $1 RETURNING *',
        [userId, name, (input.locale as string | undefined) ?? null],
      );
      return toUser(rows[0]);
    },
  };
}

export type AuthService = ReturnType<typeof authService>;
