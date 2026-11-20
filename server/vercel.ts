/**
 * Vercel entry point: the API as one Node function. The pool (and the schema check it runs)
 * is created once per warm instance, not per request.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { openPool } from './db.ts';
import { createHandler } from './index.ts';

let ready: Promise<(req: IncomingMessage, res: ServerResponse) => Promise<unknown>> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!process.env.DATABASE_URL) {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'DATABASE_URL is not configured', code: 'server_error' }));
    return;
  }
  ready ??= openPool(process.env.DATABASE_URL).then(createHandler);
  try {
    const handle = await ready;
    await handle(req, res);
  } catch (err) {
    ready = null; // retry the connection on the next request
    console.error(err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Something went wrong', code: 'server_error' }));
  }
}
