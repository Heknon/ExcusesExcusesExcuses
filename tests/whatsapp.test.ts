import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRound, formatRound } from '../shared/whatsapp.ts';

const sample = readFileSync(new URL('./sample.txt', import.meta.url), 'utf8');

test('parses all seven members in order', () => {
  const { rows, skipped } = parseRound(sample);
  assert.deepEqual(rows.map((r) => r.name), ['מייקל', 'איל', 'יוסף', 'דוד', 'אלי', 'אורי', 'רינגלר']);
  assert.deepEqual(skipped, []);
});

test('goals keep their full text, including commas', () => {
  const { rows } = parseRound(sample);
  const eli = rows.find((r) => r.name === 'אלי')!;
  assert.equal(eli.goal, 'ריצה בשישי 5קמ, מה קורה עם החול, ללמוד למקראות');
});

test('excuse picks find the target and the reason', () => {
  const { rows } = parseRound(sample);
  const get = (n: string) => rows.find((r) => r.name === n)!;
  assert.equal(get('מייקל').excuse!.target, 'אלי');
  assert.equal(get('מייקל').excuse!.reason, 'הוא יפול איפה שהוא כי יש לו הרבה דברים');
  assert.equal(get('איל').excuse!.target, 'יוסף');
  assert.equal(get('איל').excuse!.reason, 'הוא לא יקרא');
  assert.equal(get('יוסף').excuse!.target, 'אורי');
  assert.equal(get('רינגלר').excuse!.target, 'איל');
});

test('bet picks', () => {
  const { rows } = parseRound(sample);
  const targets = Object.fromEntries(rows.map((r) => [r.name, r.bet?.target]));
  assert.equal(targets['איל'], 'רינגלר');
  assert.equal(targets['אלי'], 'אורי');
  assert.equal(targets['רינגלר'], 'אלי');
  // Changed their mind mid-sentence: the last name before the reason wins.
  assert.equal(targets['מייקל'], 'רינגלר');
});

test('known member names are reused', () => {
  const { rows } = parseRound('*ביצועים*\n* מיכאל - משהו', ['מיכאל']);
  assert.equal(rows[0].name, 'מיכאל');
});

test('format round-trips through the parser', () => {
  const { rows } = parseRound(sample);
  const text = formatRound(rows.map((r) => ({
    name: r.name, goal: r.goal,
    excuseTarget: r.excuse?.target ?? null, excuseReason: r.excuse?.reason ?? '',
    betTarget: r.bet?.target ?? null, betReason: r.bet?.reason ?? '',
  })));
  const again = parseRound(text);
  assert.deepEqual(again.rows.map((r) => [r.name, r.goal, r.excuse?.target, r.bet?.target]),
    rows.map((r) => [r.name, r.goal, r.excuse?.target, r.bet?.target]));
});
