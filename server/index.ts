import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { openDb, HttpError, type Db } from './db.ts';

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://localhost:5432/excuses';
/** Optional shared team passcode. When set, every API call must send it. */
const PASSCODE = process.env.TEAM_PASSCODE ?? '';
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

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new HttpError(413, 'Body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function authorized(req: IncomingMessage) {
  if (!PASSCODE) return true;
  const got = Buffer.from(String(req.headers['x-team-passcode'] ?? ''));
  const want = Buffer.from(PASSCODE);
  return got.length === want.length && timingSafeEqual(got, want);
}

type Handler = (db: Db, params: number[], body: any) => Promise<unknown>;
const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/api\/state$/, (db) => db.state()],
  ['POST', /^\/api\/members$/, (db, _, b) => db.addMember(String(b.name ?? ''))],
  ['PATCH', /^\/api\/members\/(\d+)$/, (db, [id], b) => db.updateMember(id, b)],
  ['DELETE', /^\/api\/members\/(\d+)$/, (db, [id]) => db.deleteMember(id)],
  ['POST', /^\/api\/weeks$/, (db, _, b) => db.addWeek(b)],
  ['PATCH', /^\/api\/weeks\/(\d+)$/, (db, [id], b) => db.updateWeek(id, b)],
  ['DELETE', /^\/api\/weeks\/(\d+)$/, (db, [id]) => db.deleteWeek(id)],
  ['PATCH', /^\/api\/weeks\/(\d+)\/entries\/(\d+)$/, (db, [w, m], b) => db.updateEntry(w, m, b)],
  ['DELETE', /^\/api\/weeks\/(\d+)\/entries\/(\d+)$/, (db, [w, m]) => db.removeEntry(w, m)],
];

async function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = normalize(join(STATIC_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(STATIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(STATIC_DIR, 'index.html'); // SPA fallback
  }
  try {
    const data = await readFile(file);
    const immutable = file.includes(`${STATIC_DIR}/assets/`);
    res.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not built yet — run `npm run build`, or use `npm run dev`.');
  }
}

export function createApp(db: Db) {
  return createServer(async (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    if (!path.startsWith('/api/')) return serveStatic(req, res);
    if (path === '/api/health') {
      const dbOk = await db.pool.query('SELECT 1').then(() => true, () => false);
      return send(res, dbOk ? 200 : 503, { ok: dbOk, passcode: !!PASSCODE });
    }
    if (!authorized(req)) return send(res, 401, { error: 'Wrong team passcode' });
    for (const [method, re, handler] of routes) {
      const m = path.match(re);
      if (!m || req.method !== method) continue;
      try {
        const body = method === 'GET' || method === 'DELETE' ? {} : await readJson(req);
        const result = await handler(db, m.slice(1).map(Number), body);
        return send(res, 200, result ?? { ok: true });
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { error: err.message });
        console.error(err);
        return send(res, 500, { error: 'Server error' });
      }
    }
    send(res, 404, { error: 'Not found' });
  });
}

if (import.meta.main ?? process.argv[1]?.endsWith('index.ts')) {
  const db = await openDb(DATABASE_URL);
  const { host, pathname } = new URL(DATABASE_URL);
  createApp(db).listen(PORT, () => {
    console.log(`Excuses Excuses Excuses → http://localhost:${PORT}  (db: ${host}${pathname}${PASSCODE ? ', passcode on' : ''})`);
  });
}
