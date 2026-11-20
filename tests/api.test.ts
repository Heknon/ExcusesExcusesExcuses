// End-to-end API tests against a real Postgres. Skipped unless TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/excuses_test bun run test
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { encode } from '@auth/core/jwt';
import pg from 'pg';
import { authService } from '../server/auth.ts';
import { MIGRATIONS, migrate, openPool, type Pool } from '../server/db.ts';
import { createApp } from '../server/index.ts';
import type { GameState, Me } from '../shared/types.ts';
import { memoryStore } from './memory-store.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const schema = `test_${process.pid}`;
const SECRET = 'test-secret-test-secret-test-secret';
const SESSION_COOKIE = 'authjs.session-token';
let dbUrl = '';
let pool: Pool;
let server: Server;
let base = '';
const photos = memoryStore();

/** A browser-ish client that keeps its own session cookie. */
function client() {
  let cookie = '';
  /** What a completed Google sign-in leaves behind: the account, and an Auth.js session cookie. */
  const signIn = async (email: string, name: string, verified = true) => {
    const uid = await authService(pool).accountFor({ email, name, email_verified: verified });
    assert.ok(uid, 'verified email gets an account');
    cookie = `${SESSION_COOKIE}=${await encode({ token: { uid, sub: String(uid) }, secret: SECRET, salt: SESSION_COOKIE })}`;
    return uid;
  };
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
  /** The browser's three steps: ask for an upload URL, upload to it, then attach the photo. */
  const upload = async (path: string, bytes: Buffer, type = 'image/jpeg') => {
    const start = await call('POST', `${path}/uploads`, { type });
    if (start.status !== 200) return start;
    await photos.store.put(start.data.key, bytes, type);
    return call('POST', path, { key: start.data.key });
  };
  const raw = (path: string) => fetch(base + path, { headers: { cookie }, redirect: 'manual' });
  return { call, ok, upload, raw, signIn };
}

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);

describe('api', { skip: !URL_ && 'TEST_DATABASE_URL not set' }, () => {
  before(async () => {
    const admin = new pg.Client({ connectionString: URL_ });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const u = new URL(URL_!);
    u.searchParams.set('options', `-c search_path=${schema}`);
    dbUrl = u.toString();
    process.env.AUTH_SECRET = SECRET;
    process.env.AUTH_GOOGLE_ID = 'test-client';
    process.env.AUTH_GOOGLE_SECRET = 'test-client-secret';
    await migrate(dbUrl);
    pool = openPool(dbUrl);
    server = createApp(pool, photos.store).listen(0);
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

  test('accounts: Google sign-in by verified email, matched to existing accounts', async () => {
    const a = client();
    assert.equal((await a.call('GET', '/api/me')).status, 401);
    const auth = authService(pool);
    assert.equal(await auth.accountFor({ email: 'a@x.io', name: 'A', email_verified: false }), null, 'unverified emails are refused');
    assert.equal(await auth.accountFor({ email: 'a@x.io', name: 'A' }), null);

    await pool.query(`INSERT INTO users (email, name, password_hash) VALUES ('old@x.io', 'Oldtimer', 'scrypt$x$y')`);
    const existing = (await pool.query(`SELECT id FROM users WHERE email = 'old@x.io'`)).rows[0].id;
    assert.equal(await a.signIn('Old@X.io', 'Google Name'), existing, 'existing account, matched by email');
    const me: Me = await a.ok('GET', '/api/me');
    assert.deepEqual([me.user.id, me.user.name, me.user.email], [existing, 'Oldtimer', 'old@x.io'], 'keeps its name');

    const b = client();
    const fresh = await b.signIn('new@x.io', 'N'.repeat(60));
    assert.notEqual(fresh, existing);
    assert.equal((await b.ok('GET', '/api/me')).user.name, 'N'.repeat(40));

    const forged = await fetch(base + '/api/me', { headers: { cookie: `${SESSION_COOKIE}=not-a-token` } });
    assert.equal(forged.status, 401);
  });

  test('Auth.js is mounted at /api/auth', async () => {
    const providers = await (await fetch(base + '/api/auth/providers')).json();
    assert.equal(providers.google.callbackUrl, `${base}/api/auth/callback/google`);
    const csrf = await fetch(base + '/api/auth/csrf');
    assert.equal(csrf.status, 200);
    assert.ok((await csrf.json()).csrfToken);
    assert.ok(csrf.headers.getSetCookie().some((c) => c.startsWith('authjs.csrf-token=')));
  });

  test('writes must be JSON', async () => {
    const res = await fetch(base + '/api/games', { method: 'POST', body: 'name=a', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(res.status, 415);
  });

  test('full game: join requests, secret picks, phases, scoring data', async () => {
    const admin = client();
    const bob = client();
    const cara = client();
    await admin.signIn('admin@x.io', 'Admin');
    await bob.signIn('bob@x.io', 'Bob');
    await cara.signIn('cara@x.io', 'Cara');

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

    // Round: only admins create; one open round at a time. Rounds start with goals.
    assert.equal((await bob.call('POST', `/api/games/${g}/rounds`, { startDate: '2026-11-15' })).status, 403);
    const round = await admin.ok('POST', `/api/games/${g}/rounds`, { startDate: '2026-11-15' });
    assert.equal(round.status, 'goals');
    assert.equal((await admin.call('POST', `/api/games/${g}/rounds`, { startDate: '2026-11-22' })).status, 409);
    const entry = (c: ReturnType<typeof client>, pid: number, body: unknown) =>
      c.call('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${pid}`, body);
    const ok = (c: ReturnType<typeof client>, pid: number, body: unknown) =>
      c.ok('PATCH', `/api/games/${g}/rounds/${round.id}/entries/${pid}`, body);
    const phase = (status: string) => admin.ok('PATCH', `/api/games/${g}/rounds/${round.id}`, { status });

    // 1. Goals: shared openly; no picks yet.
    assert.equal((await entry(bob, ids.Admin, { goals: [{ text: 'hijack' }] })).status, 403, 'only your own entry');
    assert.equal((await entry(bob, ids.Bob, { excusePickId: ids.Admin })).status, 403, 'no bets before the bets phase');
    await ok(bob, ids.Bob, { goals: [{ text: 'Run 5k' }, { text: 'Stretch daily' }] });
    await ok(cara, ids['Cara (guest)'], { goals: [{ text: 'Read 50 pages' }] });
    await ok(admin, ids.Admin, { goals: [{ text: 'Ship it' }] });
    const { id: dana } = await admin.ok('POST', `/api/games/${g}/players`, { name: 'Dana' });
    await ok(admin, dana, { goals: [{ text: 'Swim' }] });
    const goalsSeen: GameState = await cara.ok('GET', `/api/games/${g}`);
    assert.deepEqual(
      goalsSeen.entries.find((e) => e.playerId === ids.Bob)!.goals.map((x) => x.text),
      ['Run 5k', 'Stretch daily'],
      'everyone sees goals as they are written',
    );

    // 2. Bets: goals lock; picks are secret.
    assert.equal((await bob.call('PATCH', `/api/games/${g}/rounds/${round.id}`, { status: 'bets' })).status, 403);
    await phase('bets');
    assert.equal((await entry(bob, ids.Bob, { goals: [{ text: 'changed my mind' }] })).status, 403, 'goals lock once betting starts');
    assert.equal((await entry(bob, ids.Bob, { excusePickId: ids.Bob })).status, 400, 'no self-picks');
    await ok(bob, ids.Bob, { excusePickId: ids['Cara (guest)'], excuseReason: 'busy week', betPickId: ids.Admin, betReason: 'focused', submitted: true });
    await ok(cara, ids['Cara (guest)'], { excusePickId: ids.Bob, betPickId: ids.Admin, submitted: true });
    await ok(admin, ids.Admin, { excusePickId: ids.Bob, betPickId: ids['Cara (guest)'], submitted: true });
    assert.equal((await entry(admin, ids.Bob, { excusePickId: ids.Admin })).status, 403, 'admins can’t touch secret picks');
    await ok(admin, dana, { betPickId: ids.Bob, submitted: true });

    const seen: GameState = await admin.ok('GET', `/api/games/${g}`);
    const bobSeen = seen.entries.find((e) => e.playerId === ids.Bob)!;
    assert.equal(bobSeen.hidden, true);
    assert.equal(bobSeen.excusePickId, null);
    assert.equal(bobSeen.submitted, true);
    assert.equal(seen.entries.find((e) => e.playerId === dana)!.betPickId, ids.Bob, 'admins see the guest picks they entered');
    const own: GameState = await bob.ok('GET', `/api/games/${g}`);
    assert.equal(own.entries.find((e) => e.playerId === ids.Bob)!.excusePickId, ids['Cara (guest)']);
    assert.equal(own.entries.find((e) => e.playerId === dana)!.hidden, true, 'other players don’t');

    // 3. The week: picks revealed; results per goal; secret votes for most impressive.
    await phase('live');
    const live: GameState = await admin.ok('GET', `/api/games/${g}`);
    assert.equal(live.entries.find((e) => e.playerId === ids.Bob)!.excusePickId, ids['Cara (guest)']);
    assert.equal((await entry(bob, ids.Bob, { betPickId: ids.Bob })).status, 403, 'bets lock when the week starts');
    const bobGoals = live.entries.find((e) => e.playerId === ids.Bob)!.goals;
    assert.equal((await entry(bob, ids.Bob, { outcome: 'done' })).data.code, 'outcome_from_goals', 'results go on goals');
    await ok(bob, ids.Bob, { goalOutcomes: { [bobGoals[0].id]: 'failed' } });
    let mid: GameState = await bob.ok('GET', `/api/games/${g}`);
    assert.equal(mid.entries.find((e) => e.playerId === ids.Bob)!.outcome, 'pending', 'pending until every goal is reported');
    await ok(bob, ids.Bob, { goalOutcomes: { [bobGoals[1].id]: 'done' }, excuse: 'Rain all week' });
    mid = await bob.ok('GET', `/api/games/${g}`);
    assert.equal(mid.entries.find((e) => e.playerId === ids.Bob)!.outcome, 'partial', 'one done, one missed');
    assert.equal((await entry(bob, ids.Bob, { goalOutcomes: { 999999: 'done' } })).status, 404);
    await ok(bob, ids.Bob, { goalOutcomes: { [bobGoals[1].id]: 'failed' } });
    const caraGoal = live.entries.find((e) => e.playerId === ids['Cara (guest)'])!.goals[0];
    await ok(cara, ids['Cara (guest)'], { goalOutcomes: { [caraGoal.id]: 'done' } });
    const adminGoal = live.entries.find((e) => e.playerId === ids.Admin)!.goals[0];
    await ok(admin, ids.Admin, { goalOutcomes: { [adminGoal.id]: 'done' } });

    assert.equal((await entry(bob, ids.Bob, { mvpVoteId: ids.Bob })).status, 400, 'no voting for yourself');
    assert.equal((await entry(admin, ids.Bob, { mvpVoteId: ids.Admin })).status, 403, 'nobody votes for an account');
    await ok(bob, ids.Bob, { mvpVoteId: ids.Admin });
    await ok(cara, ids['Cara (guest)'], { mvpVoteId: ids.Admin });
    await ok(admin, ids.Admin, { mvpVoteId: ids['Cara (guest)'] });
    const votes: GameState = await cara.ok('GET', `/api/games/${g}`);
    const bobVote = votes.entries.find((e) => e.playerId === ids.Bob)!;
    assert.equal(bobVote.voted, true);
    assert.equal(bobVote.mvpVoteId, null, 'votes stay secret until scoring');

    // Any player can add round notes; only admins finalize.
    await bob.ok('PATCH', `/api/games/${g}/rounds/${round.id}`, { notes: 'Rainy week' });
    await phase('final');
    assert.equal((await entry(bob, ids.Bob, { goalOutcomes: { [bobGoals[0].id]: 'done' } })).status, 403, 'results lock when final');
    await ok(bob, ids.Bob, { notes: 'Try mornings' });

    const final: GameState = await bob.ok('GET', `/api/games/${g}`);
    assert.equal(final.rounds[0].notes, 'Rainy week');
    assert.equal(final.entries.find((e) => e.playerId === ids.Bob)!.notes, 'Try mornings');
    assert.equal(final.entries.find((e) => e.playerId === ids.Bob)!.mvpVoteId, ids.Admin, 'votes are revealed once scored');
    assert.equal(final.entries.find((e) => e.playerId === ids.Bob)!.outcome, 'failed');
    assert.equal(final.entries.find((e) => e.playerId === ids['Cara (guest)'])!.outcome, 'done');
  });

  test('admin safety: last admin can’t leave or be demoted', async () => {
    const a = client();
    const b = client();
    await a.signIn('solo@x.io', 'Solo');
    await b.signIn('mate@x.io', 'Mate');
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
    await a.signIn('imp@x.io', 'Imp');
    const { id: g } = await a.ok('POST', '/api/games', { name: 'Imported' });
    const round = await a.ok('POST', `/api/games/${g}/rounds/import`, {
      startDate: '2026-11-15',
      rows: [
        { name: 'מייקל', goals: ['פסטה', 'ללמוד'], excuseTarget: 'אלי', excuseReason: 'עסוק', betTarget: 'רינגלר' },
        { name: 'אלי', goals: ['ריצה'], betTarget: 'מייקל' },
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

  test('language preference and error codes', async () => {
    const a = client();
    await a.signIn('lang@x.io', 'Lang');
    assert.equal((await a.ok('GET', '/api/me')).user.locale, null);
    await a.ok('PATCH', '/api/me', { locale: 'he' });
    assert.equal((await a.ok('GET', '/api/me')).user.locale, 'he');
    await a.ok('PATCH', '/api/me', { locale: 'en' });
    assert.equal((await a.ok('GET', '/api/me')).user.locale, 'en');
    const bad = await a.call('PATCH', '/api/me', { locale: 'fr' });
    assert.equal(bad.status, 400);
    assert.equal(bad.data.code, 'invalid_locale');
    assert.equal((await client().call('GET', '/api/me')).data.code, 'sign_in');
  });

  test('proof photos: who can add, see and delete them', async () => {
    const admin = client();
    const p1 = client();
    const outsider = client();
    await admin.signIn('padmin@x.io', 'PA');
    await p1.signIn('p1@x.io', 'P1');
    await outsider.signIn('out@x.io', 'Out');
    const { id: g } = await admin.ok('POST', '/api/games', { name: 'Proofs' });
    const code = (await admin.ok('GET', `/api/games/${g}`)).game.inviteCode;
    await p1.ok('POST', `/api/invites/${code}`, {});
    let st: GameState = await admin.ok('GET', `/api/games/${g}`);
    const req = st.players.find((x) => x.status === 'pending')!;
    await admin.ok('PATCH', `/api/games/${g}/players/${req.id}`, { action: 'approve' });
    const round = await admin.ok('POST', `/api/games/${g}/rounds`, { startDate: '2026-11-15' });
    const url = (pid: number) => `/api/games/${g}/rounds/${round.id}/entries/${pid}/proofs`;
    const adminId = st.me.playerId;

    assert.equal((await p1.upload(url(req.id), JPEG)).data.code, 'proof_phase', 'not before the week starts');
    await admin.ok('PATCH', `/api/games/${g}/rounds/${round.id}`, { status: 'live' });

    const up = await p1.upload(url(req.id), JPEG);
    assert.equal(up.status, 200);
    assert.equal((await p1.upload(url(adminId), JPEG)).status, 403, 'not on someone else’s entry');
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64));
    assert.equal((await p1.upload(url(req.id), html, 'image/png')).data.code, 'proof_not_image', 'checked by its bytes');
    assert.equal(photos.objects.size, 1, 'rejected uploads are deleted');
    assert.equal((await p1.call('POST', `${url(req.id)}/uploads`, { type: 'text/html' })).data.code, 'proof_not_image');
    assert.equal((await p1.call('POST', url(req.id), { key: 'test/proofs/1/1/elsewhere' })).data.code, 'proof_upload_missing');
    assert.equal((await outsider.upload(url(req.id), JPEG)).status, 404);

    st = await admin.ok('GET', `/api/games/${g}`);
    assert.deepEqual(st.entries.find((e) => e.playerId === req.id)!.proofs.map((x) => x.id), [up.data.id]);

    const img = await admin.raw(`/api/proofs/${up.data.id}`);
    assert.equal(img.status, 302);
    const key = (await pool.query('SELECT object_key FROM proofs WHERE id = $1', [up.data.id])).rows[0].object_key;
    assert.match(key, /^test\/proofs\/\d+\/\d+\/[0-9a-f-]{36}$/);
    assert.equal(img.headers.get('location'), `https://photos.test/${key}`);
    assert.equal((await outsider.raw(`/api/proofs/${up.data.id}`)).status, 404, 'outsiders can’t see proofs');
    assert.equal((await client().raw(`/api/proofs/${up.data.id}`)).status, 401);

    for (let i = 0; i < 5; i++) assert.equal((await p1.upload(url(req.id), JPEG)).status, 200);
    assert.equal((await p1.upload(url(req.id), JPEG)).data.code, 'proof_limit');
    const big = Buffer.concat([JPEG, Buffer.alloc(5 * 1024 * 1024)]);
    assert.equal((await admin.upload(url(adminId), big)).status, 413);

    assert.equal((await outsider.call('DELETE', `/api/proofs/${up.data.id}`, {})).status, 404);
    await p1.ok('DELETE', `/api/proofs/${up.data.id}`, {});
    assert.equal((await admin.raw(`/api/proofs/${up.data.id}`)).status, 404);
    assert.equal(photos.objects.has(key), false, 'deleting a proof deletes its photo');

    // Photos from before the move to S3 are still served from the database.
    const legacy = await pool.query(
      'INSERT INTO proofs (round_id, player_id, mime, bytes) VALUES ($1, $2, $3, $4) RETURNING id',
      [round.id, adminId, 'image/jpeg', JPEG],
    );
    const old = await admin.raw(`/api/proofs/${legacy.rows[0].id}`);
    assert.equal(old.status, 200);
    assert.equal(old.headers.get('content-type'), 'image/jpeg');
    assert.equal(old.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await old.arrayBuffer()), JPEG);

    assert.ok(photos.objects.size > 0);
    await admin.ok('DELETE', `/api/games/${g}/rounds/${round.id}`, {});
    assert.equal(photos.objects.size, 0, 'deleting a round deletes its photos');
  });

  test('goals: editing keeps results, limits, and lock-in needs a goal', async () => {
    const a = client();
    await a.signIn('goals@x.io', 'G');
    const { id: g } = await a.ok('POST', '/api/games', { name: 'Goals' });
    const round = await a.ok('POST', `/api/games/${g}/rounds`, { startDate: '2026-11-15', deadline: '2026-11-20T16:00:00.000Z' });
    assert.equal(round.deadline, '2026-11-20T16:00:00.000Z');
    const me = (await a.ok('GET', `/api/games/${g}`)).me.playerId;
    const url = `/api/games/${g}/rounds/${round.id}/entries/${me}`;

    await a.ok('PATCH', `/api/games/${g}/rounds/${round.id}`, { status: 'bets' });
    assert.equal((await a.call('PATCH', url, { submitted: true })).data.code, 'goal_required', 'no betting without goals');
    await a.ok('PATCH', `/api/games/${g}/rounds/${round.id}`, { status: 'goals' });
    const six = Array.from({ length: 6 }, (_, i) => ({ text: `goal ${i}` }));
    assert.equal((await a.call('PATCH', url, { goals: six })).data.code, 'too_many_goals');
    await a.ok('PATCH', url, { goals: [{ text: 'A' }, { text: '  ' }, { text: 'B' }] });
    let st: GameState = await a.ok('GET', `/api/games/${g}`);
    const [ga, gb] = st.entries[0].goals;
    assert.deepEqual([ga.text, gb.text], ['A', 'B'], 'blank goals are dropped');

    // Reorder + rename keeps ids; removed goals go away.
    await a.ok('PATCH', url, { goals: [{ id: gb.id, text: 'B2' }, { text: 'C' }] });
    st = await a.ok('GET', `/api/games/${g}`);
    assert.deepEqual(st.entries[0].goals.map((x) => [x.id === gb.id, x.text]), [[true, 'B2'], [false, 'C']]);

    // Admin moves the deadline; players can't.
    await a.ok('PATCH', `/api/games/${g}/rounds/${round.id}`, { deadline: '2026-11-21T20:00:00Z' });
    st = await a.ok('GET', `/api/games/${g}`);
    assert.equal(st.rounds[0].deadline, '2026-11-21T20:00:00.000Z');
    assert.equal((await a.call('PATCH', `/api/games/${g}/rounds/${round.id}`, { deadline: 'soon' })).data.code, 'invalid_deadline');
  });

  test('migrations: tracked, applied once, old single goals move into the goal list', async () => {
    assert.deepEqual(await migrate(dbUrl), [], 'nothing left to apply');
    const a = client();
    await a.signIn('legacy@x.io', 'L');
    const { id: g } = await a.ok('POST', '/api/games', { name: 'Legacy' });
    const round = await a.ok('POST', `/api/games/${g}/rounds`, { startDate: '2026-11-15' });
    const me = (await a.ok('GET', `/api/games/${g}`)).me.playerId;
    // A row written by the version before multi-goal support, then the initial migration as it ran on startup.
    await pool.query(`UPDATE round_entries SET goal = 'Old style goal', outcome = 'done' WHERE round_id = $1`, [round.id]);
    await pool.query(MIGRATIONS[0].sql);
    const st: GameState = await a.ok('GET', `/api/games/${g}`);
    const e = st.entries.find((x) => x.playerId === me)!;
    assert.deepEqual(e.goals.map((x) => [x.text, x.outcome]), [['Old style goal', 'done']]);
    await pool.query(MIGRATIONS[0].sql);
    assert.equal((await a.ok('GET', `/api/games/${g}`)).entries.find((x: any) => x.playerId === me).goals.length, 1);
  });
});
