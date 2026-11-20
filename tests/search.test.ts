import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search } from '../shared/search.ts';
import { emptyEntry, type AppState } from '../shared/types.ts';

const state: AppState = {
  members: [
    { id: 1, name: 'אלי', active: true },
    { id: 2, name: 'אורי', active: true },
  ],
  weeks: [
    { id: 1, title: '', startDate: '2026-11-08', closed: true, notes: 'Holiday week' },
    { id: 2, title: '', startDate: '2026-11-15', closed: false, notes: '' },
  ],
  entries: [
    { ...emptyEntry(1, 1), goal: 'ריצה 5 קמ', excuse: 'Sand in my shoes' },
    { ...emptyEntry(2, 1), goal: 'ריצה בשישי' },
    { ...emptyEntry(2, 2), goal: 'קאליסטניקס', notes: 'ריצה קלה ביום ראשון' },
  ],
};
const names = new Map(state.members.map((m) => [m.id, m.name]));
const find = (q: string) => search(state, q, names).map((h) => `${h.week.id}:${h.entry?.memberId ?? '-'}:${h.field}`);

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

test('matches week notes', () => {
  assert.deepEqual(find('holiday'), ['1:-:weekNotes']);
});
