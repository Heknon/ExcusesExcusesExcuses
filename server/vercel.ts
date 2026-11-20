/**
 * Vercel entry point: the API as one Node function. The pool is created once per warm instance.
 * Migrations run before each deploy (`bun run db:migrate:deploy`), not here.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { openPool } from './db.ts';
import { createHandler } from './index.ts';
import { photoStoreFromEnv } from './storage.ts';

let handle: ((req: IncomingMessage, res: ServerResponse) => Promise<unknown>) | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!process.env.DATABASE_URL) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'DATABASE_URL is not configured', code: 'server_error' }));
    return;
  }
  handle ??= createHandler(openPool(process.env.DATABASE_URL), photoStoreFromEnv());
  await handle(req, res);
}
