import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { User } from '../shared/types.ts';
import { authService, SESSION_COOKIE, SESSION_DAYS } from './auth.ts';
import { HttpError, openPool, type Pool } from './db.ts';
import { gameService, PROOF_MAX_BYTES } from './games.ts';

const PROOF_UPLOAD = /^\/api\/games\/(\d+)\/rounds\/(\d+)\/entries\/(\d+)\/proofs$/;
const PROOF_GET = /^\/api\/proofs\/(\d+)$/;

const STATIC_DIR = resolve('dist');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body ?? { ok: true }));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > limit) throw new HttpError(413, 'request_too_large');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'request_too_large');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<any> {
  const raw = await readBody(req, 1_000_000);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

function cookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req: IncomingMessage, token: string | null): string {
  const secure = req.headers['x-forwarded-proto'] === 'https' || process.env.NODE_ENV === 'production';
  const attrs = ['Path=/', 'HttpOnly', 'SameSite=Lax', ...(secure ? ['Secure'] : [])];
  return token
    ? `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_DAYS * 86400}; ${attrs.join('; ')}`
    : `${SESSION_COOKIE}=; Max-Age=0; ${attrs.join('; ')}`;
}

interface Ctx {
  req: IncomingMessage;
  user: User | null;
  params: number[];
  body: any;
  query: URLSearchParams;
}
type Handler = (ctx: Ctx & { user: User }) => Promise<unknown>;
type PublicHandler = (ctx: Ctx) => Promise<{ body: unknown; cookie?: string | null } | unknown>;

/** The whole app as a plain Node request handler: used by the local server and by the Vercel function. */
export function createHandler(pool: Pool) {
  const auth = authService(pool);
  const games = gameService(pool);

  // Routes that need a signed-in user. `:id`-style segments are matched as integers.
  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/me$/, async ({ user }) => ({ user, games: await games.listForUser(user.id) })],
    ['PATCH', /^\/api\/me$/, async ({ user, body }) => auth.updateProfile(user.id, body)],
    ['POST', /^\/api\/games$/, async ({ user, body }) => games.create(user, body)],
    ['GET', /^\/api\/invites\/([A-Za-z0-9]+)$/, async ({ user, req }) => games.lookupInvite(user.id, inviteCode(req))],
    ['POST', /^\/api\/invites\/([A-Za-z0-9]+)$/, async ({ user, req }) => games.requestJoin(user, inviteCode(req))],
    ['GET', /^\/api\/games\/(\d+)$/, async ({ user, params: [g] }) => games.state(user.id, g)],
    ['PATCH', /^\/api\/games\/(\d+)$/, async ({ user, params: [g], body }) => games.update(user.id, g, body)],
    ['DELETE', /^\/api\/games\/(\d+)$/, async ({ user, params: [g] }) => games.remove(user.id, g)],
    ['POST', /^\/api\/games\/(\d+)\/leave$/, async ({ user, params: [g] }) => games.leave(user.id, g)],
    ['DELETE', /^\/api\/games\/(\d+)\/request$/, async ({ user, params: [g] }) => games.cancelRequest(user.id, g)],
    ['POST', /^\/api\/games\/(\d+)\/players$/, async ({ user, params: [g], body }) => games.addGuest(user.id, g, body)],
    ['PATCH', /^\/api\/games\/(\d+)\/players\/(\d+)$/, async ({ user, params: [g, p], body }) => games.updatePlayer(user.id, g, p, body)],
    ['POST', /^\/api\/games\/(\d+)\/rounds$/, async ({ user, params: [g], body }) => games.createRound(user.id, g, body)],
    ['POST', /^\/api\/games\/(\d+)\/rounds\/import$/, async ({ user, params: [g], body }) => games.importRound(user.id, g, body)],
    ['PATCH', /^\/api\/games\/(\d+)\/rounds\/(\d+)$/, async ({ user, params: [g, r], body }) => games.updateRound(user.id, g, r, body)],
    ['DELETE', /^\/api\/games\/(\d+)\/rounds\/(\d+)$/, async ({ user, params: [g, r] }) => games.deleteRound(user.id, g, r)],
    [
      'PATCH',
      /^\/api\/games\/(\d+)\/rounds\/(\d+)\/entries\/(\d+)$/,
      async ({ user, params: [g, r, p], body }) => games.updateEntry(user.id, g, r, p, body),
    ],
    ['DELETE', /^\/api\/proofs\/(\d+)$/, async ({ user, params: [id] }) => games.deleteProof(user.id, id)],
    [
      'DELETE',
      /^\/api\/games\/(\d+)\/rounds\/(\d+)\/entries\/(\d+)$/,
      async ({ user, params: [g, r, p] }) => games.removeEntry(user.id, g, r, p),
    ],
  ];

  const publicRoutes: [string, RegExp, PublicHandler][] = [
    ['GET', /^\/api\/health$/, async () => ({ ok: await pool.query('SELECT 1').then(() => true, () => false) })],
    ['POST', /^\/api\/auth\/signup$/, async ({ body }) => {
      const { user, token } = await auth.signup(body);
      return { body: { user }, cookie: token };
    }],
    ['POST', /^\/api\/auth\/login$/, async ({ body }) => {
      const { user, token } = await auth.login(body);
      return { body: { user }, cookie: token };
    }],
    ['POST', /^\/api\/auth\/logout$/, async ({ req }) => {
      const token = cookies(req)[SESSION_COOKIE];
      if (token) await auth.logout(token);
      return { body: { ok: true }, cookie: null };
    }],
  ];

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);

    try {
      const method = req.method ?? 'GET';
      const user = await auth.userForToken(cookies(req)[SESSION_COOKIE]);

      // Binary routes: proof photos.
      const upload = url.pathname.match(PROOF_UPLOAD);
      if (upload && method === 'POST') {
        // Only image types are accepted: like JSON, browsers can't send them cross-site without a preflight.
        if (!String(req.headers['content-type'] ?? '').startsWith('image/')) throw new HttpError(415, 'proof_not_image');
        if (!user) throw new HttpError(401, 'sign_in');
        const bytes = await readBody(req, PROOF_MAX_BYTES).catch((err) => {
          throw err instanceof HttpError && err.code === 'request_too_large' ? new HttpError(413, 'proof_too_large') : err;
        });
        const [g, r, p] = upload.slice(1).map(Number);
        return send(res, 200, await games.addProof(user, g, r, p, bytes));
      }
      const download = url.pathname.match(PROOF_GET);
      if (download && method === 'GET') {
        if (!user) throw new HttpError(401, 'sign_in');
        const proof = await games.proof(user.id, Number(download[1]));
        res.writeHead(200, {
          'content-type': proof.mime,
          'content-length': proof.bytes.length,
          // Proof ids never change content, so the browser can keep them; never shared caches.
          'cache-control': 'private, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'none'",
          'content-disposition': 'inline',
        });
        return res.end(proof.bytes);
      }

      // Everything else: writes must be JSON, which browsers can't send cross-site without a CORS preflight.
      if (method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        throw new HttpError(415, 'unsupported_type');
      }
      const body = method === 'GET' ? {} : await readJson(req);
      const base = { req, user, body, query: url.searchParams };

      for (const [m, re, handler] of publicRoutes) {
        const match = url.pathname.match(re);
        if (!match || m !== method) continue;
        const out: any = await handler({ ...base, params: match.slice(1).map(Number) });
        if (out && 'cookie' in out) {
          return send(res, 200, out.body, { 'set-cookie': sessionCookie(req, out.cookie) });
        }
        return send(res, 200, out);
      }
      for (const [m, re, handler] of routes) {
        const match = url.pathname.match(re);
        if (!match || m !== method) continue;
        if (!user) throw new HttpError(401, 'sign_in');
        return send(res, 200, await handler({ ...base, user, params: match.slice(1).map(Number) }));
      }
      throw new HttpError(404, 'not_found');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message, code: err.code });
      console.error(err);
      return send(res, 500, { error: 'Something went wrong', code: 'server_error' });
    }
  };
}

export function createApp(pool: Pool) {
  return createServer(createHandler(pool));
}

function inviteCode(req: IncomingMessage): string {
  return new URL(req.url ?? '/', 'http://localhost').pathname.split('/').pop() ?? '';
}

async function serveStatic(pathname: string, res: ServerResponse) {
  let file = normalize(join(STATIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(STATIC_DIR, 'index.html'); // client-side routes
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': file.includes(`${STATIC_DIR}/assets/`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not built yet: run `npm run build`, or use `npm run dev`.');
  }
}

if (import.meta.main ?? process.argv[1]?.endsWith('index.ts')) {
  const PORT = Number(process.env.PORT ?? 3000);
  const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/excuses';
  const pool = await openPool(DATABASE_URL);
  const { host, pathname } = new URL(DATABASE_URL);
  createApp(pool).listen(PORT, () => console.log(`Excuses Excuses Excuses → http://localhost:${PORT}  (db: ${host}${pathname})`));
}
