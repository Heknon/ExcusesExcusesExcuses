// Integration tests against a real Postgres. Skipped unless TEST_DATABASE_URL is set, e.g.
//   TEST_DATABASE_URL=postgres://postgres@localhost:5432/excuses_test npm test
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { openDb, type Db } from '../server/db.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const schema = `test_${process.pid}`;
let db: Db | undefined;

async function setup() {
  if (db) return db;
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();
  const u = new URL(URL_!);
  u.searchParams.set('options', `-c search_path=${schema}`);
  db = await openDb(u.toString());
  return db;
}

after(async () => {
  if (!db) return;
  await db.close();
  const admin = new pg.Client({ connectionString: URL_ });
  await admin.connect();
  await admin.query(`DROP SCHEMA ${schema} CASCADE`);
  await admin.end();
});

test('postgres: members, weeks and entries round-trip', { skip: !URL_ && 'TEST_DATABASE_URL not set' }, async () => {
  const d = await setup();
  const a = await d.addMember(' מייקל ');
  const b = await d.addMember('אלי');
  assert.equal(a.name, 'מייקל');
  assert.equal((await d.addMember('מייקל')).id, a.id, 'adding an existing name returns it');

  const week = await d.addWeek({
    startDate: '2026-11-15',
    entries: [
      { memberId: a.id, goal: 'פסטה', excusePickId: b.id, excuseReason: 'כי כן' },
      { memberId: b.id, goal: 'ריצה' },
    ],
  });
  assert.equal(week.startDate, '2026-11-15');

  await d.updateEntry(week.id, b.id, { outcome: 'failed', excuse: 'חול' });
  await d.updateWeek(week.id, { closed: true, title: 'שבוע 1' });

  const s = await d.state();
  assert.equal(s.weeks[0].title, 'שבוע 1');
  assert.equal(s.weeks[0].closed, true);
  const eli = s.entries.find((e) => e.memberId === b.id)!;
  assert.deepEqual([eli.goal, eli.outcome, eli.excuse], ['ריצה', 'failed', 'חול']);
  assert.equal(s.entries.find((e) => e.memberId === a.id)!.excusePickId, b.id);

  await assert.rejects(d.updateEntry(week.id, a.id, { outcome: 'nope' as any }), /Bad outcome/);
  await assert.rejects(d.updateMember(b.id, { name: 'מייקל' }), (e: any) => e.status === 409);

  // Deleting a member clears picks of them and drops their entries.
  await d.deleteMember(b.id);
  const s2 = await d.state();
  assert.equal(s2.entries.length, 1);
  assert.equal(s2.entries[0].excusePickId, null);
});

test('postgres: new week includes only active members', { skip: !URL_ && 'TEST_DATABASE_URL not set' }, async () => {
  const d = await setup();
  const c = await d.addMember('דוד');
  const e = await d.addMember('אורי');
  await d.updateMember(e.id, { active: false });
  const w = await d.addWeek({ startDate: '2026-11-22' });
  const ids = (await d.state()).entries.filter((x) => x.weekId === w.id).map((x) => x.memberId);
  assert.ok(ids.includes(c.id));
  assert.ok(!ids.includes(e.id));
});
