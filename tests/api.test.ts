// End-to-end API tests against a real Postgres. Skipped unless TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/excuses_test npm test
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import pg from 'pg';
import { openPool, type Pool } from '../server/db.ts';
import { createApp } from '../server/index.ts';
import type { GameState, Me } from '../shared/types.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const schema = `test_${process.pid}`;
let pool: Pool;
let server: Server;
let base = '';

/** A browser-ish client that keeps its own session cookie. */
function client() {
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data: any = await res.json();
    return { status: res.status, data };
  };
  const ok = async (method: string, path: string, body?: unknown) => {
    const r = await call(method, path, body);
    assert.equal(r.status, 200, `${method} ${path} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return { call, ok };
}

describe('api', { skip: !URL_ && 'TEST_DATABASE_URL not set' }, () => {
  before(async () => {
    const admin = new pg.Client({ connectionString: URL_ });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const u = new URL(URL_!);
    u.searchParams.set('options', `-c search_path=${schema}`);
    pool = await openPool(u.toString());
    server = createApp(pool).listen(0);
    base = `http://localhost:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server?.close();
    await pool?.end();
    const admin = new pg.Client({ connectionString: URL_ });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  test('accounts: signup, login, logout, validation', async () => {
    const a = client();
    assert.equal((await a.call('GET', '/api/me')).status, 401);
    assert.equal((await a.call('POST', '/api/auth/signup', { email: 'bad', name: 'x', password: 'longenough' })).status, 400);
    assert.equal((await a.call('POST', '/api/auth/signup', { email: 'a@x.io', name: 'A', password: 'short' })).status, 400);
    await a.ok('POST', '/api/auth/signup', { email: 'A@x.io', name: 'Avi', password: 'password1' });
    assert.equal((await a.ok('GET', '/api/me')).user.email, 'a@x.io');
    assert.equal((await client().call('POST', '/api/auth/signup', { email: 'a@x.io', name: 'Dup', password: 'password1' })).status, 409);

    await a.ok('POST', '/api/auth/logout', {});
    assert.equal((await a.call('GET', '/api/me')).status, 401);
    assert.equal((await a.call('POST', '/api/auth/login', { email: 'a@x.io', password: 'wrong-pass' })).status, 401);
    await a.ok('POST', '/api/auth/login', { email: 'a@x.io', password: 'password1' });
    assert.equal((await a.ok('GET', '/api/me')).user.name, 'Avi');
  });

  test('writes must be JSON', async () => {
    const res = await fetch(base + '/api/auth/login', { method: 'POST', body: 'email=a', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(res.status, 415);
  });

  test('full game: join requests, secret picks, phases, scoring data', async () => {
    const admin = client();
    const bob = client();
    const cara = client();
    await admin.ok('POST', '/api/auth/signup', { email: 'admin@x.io', name: 'Admin', password: 'password1' });
    await bob.ok('POST', '/api/auth/signup', { email: 'bob@x.io', name: 'Bob', password: 'password1' });
    await cara.ok('POST', '/api/auth/signup', { email: 'cara@x.io', name: 'Cara', password: 'password1' });

    const { id: g } = await admin.ok('POST', '/api/games', { name: 'The Group' });
    const state0: GameState = await admin.ok('GET', `/api/games/${g}`);
    const code = state0.game.inviteCode!;
    assert.match(code, /^[A-Z2-9]{6}$/);

    // Outsiders can't see the game; invite lookup works.
    assert.equal((await bob.call('GET', `/api/games/${g}`)).status, 404);
    assert.equal((await bob.ok('GET', `/api/invites/${code.toLowerCase()}`)).name, 'The Group');

    // Join requests wait for the admin.
    assert.equal((await bob.ok('POST', `/api/invites/${code}`, {})).status, 'pending');
    await cara.ok('POST', `/api/invites/${code}`, {});
    assert.equal((await bob.call('GET', `/api/games/${g}`)).status, 403);
    const me: Me = await admin.ok('GET', '/api/me');
    assert.equal(me.games[0].pendingRequests, 2);
    assert.equal(me.games[0].todo, 'requests');

    // A guest with history; Cara's account takes over that seat on approval.
    const { id: guestId } = await admin.ok('POST', `/api/games/${g}/players`, { name: 'Cara (guest)' });
    let st: GameState = await admin.ok('GET', `/api/games/${g}`);
    const bobReq = st.players.find((p) => p.email === 'bob@x.io')!;
    const caraReq = st.players.find((p) => p.email === 'cara@x.io')!;
    assert.equal(bobReq.status, 'pending');
    assert.equal((await bob.call('PATCH', `/api/games/${g}/players/${caraReq.id}`, { action: 'approve' })).status, 403);
    await admin.ok('PATCH', `/api/games/${g}/players/${bobReq.id}`, { action: 'approve' });
    await admin.ok('PATCH', `/api/games/${g}/players/${caraReq.id}`, { action: 'approve', guestId });

    st = await bob.ok('GET', `/api/games/${g}`);
    assert.equal(st.game.inviteCode, null, 'only admins see the invite code');
    assert.deepEqual(st.players.map((p) => p.name).sort(), ['Admin', 'Bob', 'Cara (guest)']);
    const ids = Object.fromEntries(st.players.map((p) => [p.name, p.id]));
    const caraSt: GameState = await cara.ok('GET', `/api/games/${g}`);
    assert.equal(caraSt.me.playerId, guestId);

    // Round: only admins create; one open round at a time.
    assert.equal((await bob.call('POST', `/api/games/${g}/rounds`, { startDate: '2026-11-15' })).status, 403);
    const round = await admin.ok('POST', `/api/games/${g}/rounds`, { startDate: '2026-11-15' });
    assert.equal(round.status, 'planning');
    assert.equal((await admin.call('POST', `/api/games/${g}/rounds`, { startDate: '2026-11-22' })).status, 409);
    const entry = (c: ReturnType<typeof client>, pid: number, body: unknown) =>
      c.call('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${pid}`, body);

    // Planning: everyone locks in their move; picks stay secret.
    assert.equal((await entry(bob, ids.Bob, { goal: 'Run 5k', excusePickId: ids.Bob })).status, 400, 'no self-picks');
    assert.equal((await entry(bob, ids.Admin, { goal: 'hijack' })).status, 403, 'only your own entry');
    assert.equal((await entry(bob, ids.Bob, { outcome: 'done' })).status, 403, 'no results during planning');
    await bob.ok('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${ids.Bob}`, {
      goal: 'Run 5k', excusePickId: ids['Cara (guest)'], excuseReason: 'busy week', betPickId: ids.Admin, betReason: 'focused', submitted: true,
    });
    await cara.ok('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${ids['Cara (guest)']}`, {
      goal: 'Read 50 pages', excusePickId: ids.Bob, betPickId: ids.Admin, submitted: true,
    });
    await admin.ok('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${ids.Admin}`, {
      goal: 'Ship it', excusePickId: ids.Bob, betPickId: ids['Cara (guest)'], submitted: true,
    });
    assert.equal((await entry(admin, ids.Bob, { excusePickId: ids.Admin })).status, 403, 'admins can’t touch secret picks');
    const { id: dana } = await admin.ok('POST', `/api/games/${g}/players`, { name: 'Dana' });
    await admin.ok('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${dana}`, { goal: 'Swim', betPickId: ids.Bob, submitted: true });
    const guestSeen: GameState = await admin.ok('GET', `/api/games/${g}`);
    assert.equal(guestSeen.entries.find((e) => e.playerId === dana)!.betPickId, ids.Bob, 'admins see the guest picks they entered');
    const guestHidden: GameState = await bob.ok('GET', `/api/games/${g}`);
    assert.equal(guestHidden.entries.find((e) => e.playerId === dana)!.hidden, true, 'other players don’t');

    const seen: GameState = await admin.ok('GET', `/api/games/${g}`);
    const bobSeen = seen.entries.find((e) => e.playerId === ids.Bob)!;
    assert.equal(bobSeen.hidden, true);
    assert.equal(bobSeen.excusePickId, null);
    assert.equal(bobSeen.goal, 'Run 5k');
    assert.equal(bobSeen.submitted, true);
    const own: GameState = await bob.ok('GET', `/api/games/${g}`);
    assert.equal(own.entries.find((e) => e.playerId === ids.Bob)!.excusePickId, ids['Cara (guest)']);

    // Live: picks revealed, players report their own results.
    assert.equal((await bob.call('PATCH', `/api/games/${g}/rounds/${round.id}`, { status: 'live' })).status, 403);
    await admin.ok('PATCH', `/api/games/${g}/rounds/${round.id}`, { status: 'live' });
    const live: GameState = await admin.ok('GET', `/api/games/${g}`);
    assert.equal(live.entries.find((e) => e.playerId === ids.Bob)!.excusePickId, ids['Cara (guest)']);
    assert.equal((await entry(bob, ids.Bob, { goal: 'changed my mind' })).status, 403, 'goals lock when live');
    await bob.ok('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${ids.Bob}`, { outcome: 'failed', excuse: 'Rain all week' });
    await cara.ok('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${ids['Cara (guest)']}`, { outcome: 'done' });
    await admin.ok('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${ids.Admin}`, { outcome: 'done' });

    // Any player can add round notes; only admins finalize.
    await bob.ok('PATCH', `/api/games/${g}/rounds/${round.id}`, { notes: 'Rainy week' });
    await admin.ok('PATCH', `/api/games/${g}/rounds/${round.id}`, { status: 'final' });
    assert.equal((await entry(bob, ids.Bob, { outcome: 'done' })).status, 403, 'results lock when final');
    await bob.ok('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${ids.Bob}`, { notes: 'Try mornings' });

    const final: GameState = await bob.ok('GET', `/api/games/${g}`);
    assert.equal(final.rounds[0].notes, 'Rainy week');
    assert.equal(final.entries.find((e) => e.playerId === ids.Bob)!.notes, 'Try mornings');
  });

  test('admin safety: last admin can’t leave or be demoted', async () => {
    const a = client();
    const b = client();
    await a.ok('POST', '/api/auth/signup', { email: 'solo@x.io', name: 'Solo', password: 'password1' });
    await b.ok('POST', '/api/auth/signup', { email: 'mate@x.io', name: 'Mate', password: 'password1' });
    const { id: g } = await a.ok('POST', '/api/games', { name: 'Two' });
    const code = (await a.ok('GET', `/api/games/${g}`)).game.inviteCode;
    await b.ok('POST', `/api/invites/${code}`, {});
    const st: GameState = await a.ok('GET', `/api/games/${g}`);
    const mate = st.players.find((p) => p.status === 'pending')!;
    await a.ok('PATCH', `/api/games/${g}/players/${mate.id}`, { action: 'approve' });

    assert.equal((await a.call('POST', `/api/games/${g}/leave`, {})).status, 400);
    assert.equal((await a.call('PATCH', `/api/games/${g}/players/${st.me.playerId}`, { action: 'update', role: 'player' })).status, 400);
    await a.ok('PATCH', `/api/games/${g}/players/${mate.id}`, { action: 'update', role: 'admin' });
    await a.ok('POST', `/api/games/${g}/leave`, {});
    assert.equal((await a.call('GET', `/api/games/${g}`)).status, 404);
  });

  test('import a WhatsApp round creates guests and a live round', async () => {
    const a = client();
    await a.ok('POST', '/api/auth/signup', { email: 'imp@x.io', name: 'Imp', password: 'password1' });
    const { id: g } = await a.ok('POST', '/api/games', { name: 'Imported' });
    const round = await a.ok('POST', `/api/games/${g}/rounds/import`, {
      startDate: '2026-11-15',
      rows: [
        { name: 'מייקל', goal: 'פסטה', excuseTarget: 'אלי', excuseReason: 'עסוק', betTarget: 'רינגלר' },
        { name: 'אלי', goal: 'ריצה', betTarget: 'מייקל' },
      ],
    });
    assert.equal(round.status, 'live');
    const st: GameState = await a.ok('GET', `/api/games/${g}`);
    assert.deepEqual(st.players.map((p) => p.name), ['Imp', 'מייקל', 'אלי', 'רינגלר']);
    const mike = st.players.find((p) => p.name === 'מייקל')!;
    const e = st.entries.find((x) => x.playerId === mike.id)!;
    assert.equal(e.excusePickId, st.players.find((p) => p.name === 'אלי')!.id);
    assert.equal(e.submitted, true);
  });
});
