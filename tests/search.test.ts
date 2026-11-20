import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../shared/search.ts';
import { emptyEntry, type Entry, type Round } from '../shared/types.ts';

const goal = (id: number, text: string) => ({ id, text, outcome: 'pending' as const });
const names = new Map([
  [1, 'אלי'],
  [2, 'אורי'],
]);
const data: { rounds: Round[]; entries: Entry[] } = {
  rounds: [
    { id: 1, title: '', startDate: '2026-11-08', deadline: '', status: 'final', notes: 'Holiday week' },
    { id: 2, title: '', startDate: '2026-11-15', deadline: '', status: 'live', notes: '' },
  ],
  entries: [
    { ...emptyEntry(1, 1), goals: [goal(1, 'ריצה 5 קמ')], excuse: 'Sand in my shoes' },
    { ...emptyEntry(2, 1), goals: [goal(2, 'ריצה בשישי'), goal(3, 'לקרוא פרק')] },
    { ...emptyEntry(2, 2), goals: [goal(4, 'קאליסטניקס')], notes: 'ריצה קלה ביום ראשון' },
  ],
};
const find = (q: string) => search(data, q, names).map((h) => `${h.round.id}:${h.entry?.playerId ?? '-'}:${h.field}`);

test('finds text across fields, newest week first', () => {
  assert.deepEqual(find('ריצה'), ['2:1:goal', '2:2:notes', '1:1:goal']);
});

test('is case-insensitive and needs every term', () => {
  assert.deepEqual(find('SAND shoes'), ['1:1:excuse']);
  assert.deepEqual(find('sand boots'), []);
});

test("a member's name narrows to their entries but never matches on its own", () => {
  assert.deepEqual(find('אורי ריצה'), ['2:2:notes']);
  assert.deepEqual(find('אורי'), []);
});

test('each goal is searchable on its own', () => {
  assert.deepEqual(find('פרק'), ['2:1:goal']);
});

test('matches round notes', () => {
  assert.deepEqual(find('holiday'), ['1:-:roundNotes']);
});
