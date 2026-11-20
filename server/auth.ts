import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { Auth, type AuthConfig } from '@auth/core';
import { getToken } from '@auth/core/jwt';
import Google from '@auth/core/providers/google';
import { HttpError, type Pool } from './db.ts';
import { LOCALES, type Locale, type User } from '../shared/types.ts';

export const AUTH_BASE_PATH = '/api/auth';
export const SESSION_DAYS = 60;
const NAME_MAX = 40;

const toUser = (r: any): User => ({ id: r.id, email: r.email, name: r.name, locale: r.locale ?? null });

/** The email of a Google profile, only when Google has verified it. */
export function verifiedEmail(profile: unknown): string | null {
  const p = profile as { email?: unknown; email_verified?: unknown } | null | undefined;
  if (p?.email_verified !== true || typeof p.email !== 'string') return null;
  return p.email.trim().toLowerCase() || null;
}

function displayName(profile: { name?: unknown } | null | undefined, email: string): string {
  const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
  return (name || email.split('@')[0]).slice(0, NAME_MAX);
}

function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) for (const item of v) headers.append(k, item);
    else if (v != null) headers.set(k, v);
  }
  return headers;
}

/** The public origin of a request: AUTH_URL when set, otherwise what the proxy in front of us reports. */
export function requestOrigin(req: IncomingMessage): string {
  if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.split(',')[0].trim();
  const host = first(req.headers['x-forwarded-host']) ?? req.headers.host ?? 'localhost';
  const proto = first(req.headers['x-forwarded-proto']) ?? 'http';
  return `${proto}://${host}`;
}

export function authService(pool: Pool) {
  /** The account for a Google profile with a verified email: the existing one with that email, or a new one. */
  async function accountFor(profile: unknown): Promise<number | null> {
    const email = verifiedEmail(profile);
    if (!email) return null;
    const { rows } = await pool.query(
      `INSERT INTO users (email, name) VALUES ($1, $2)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`,
      [email, displayName(profile as { name?: unknown }, email)],
    );
    return rows[0].id;
  }

  const config: AuthConfig = {
    basePath: AUTH_BASE_PATH,
    secret: process.env.AUTH_SECRET || undefined,
    trustHost: true,
    redirectProxyUrl: process.env.AUTH_REDIRECT_PROXY_URL || undefined,
    providers: [Google({ clientId: process.env.AUTH_GOOGLE_ID, clientSecret: process.env.AUTH_GOOGLE_SECRET })],
    session: { strategy: 'jwt', maxAge: SESSION_DAYS * 86400 },
    pages: { signIn: '/login', error: '/login' },
    callbacks: {
      signIn: ({ account, profile }) => account?.provider === 'google' && verifiedEmail(profile) !== null,
      async jwt({ token, profile }) {
        if (profile) token.uid = await accountFor(profile);
        return token;
      },
    },
  };

  return {
    accountFor,

    /** Serve /api/auth/* (sign-in, Google callback, sign-out, CSRF) through Auth.js. */
    async handle(req: IncomingMessage, res: ServerResponse, body: Buffer) {
      const method = req.method ?? 'GET';
      const request = new Request(new URL(req.url ?? '/', requestOrigin(req)), {
        method,
        headers: toHeaders(req.headers),
        body: method === 'GET' || method === 'HEAD' ? undefined : new Uint8Array(body),
      });
      const response = await Auth(request, config);
      const headers: Record<string, string | string[]> = {};
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') headers[key] = value;
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    },

    async userFor(req: IncomingMessage): Promise<User | null> {
      if (!process.env.AUTH_SECRET) return null;
      const token = await getToken({
        req: { headers: toHeaders(req.headers) },
        secret: process.env.AUTH_SECRET || undefined,
        secureCookie: requestOrigin(req).startsWith('https:'),
      });
      const uid = token?.uid;
      if (typeof uid !== 'number') return null;
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [uid]);
      return rows[0] ? toUser(rows[0]) : null;
    },

    async updateProfile(userId: number, input: { name?: unknown; locale?: unknown }) {
      let name: string | null = null;
      if (input.name !== undefined) {
        name = String(input.name ?? '').trim();
        if (!name) throw new HttpError(400, 'name_required');
        if (name.length > NAME_MAX) throw new HttpError(400, 'name_too_long');
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
