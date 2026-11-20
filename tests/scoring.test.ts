import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from '../shared/scoring.ts';
import { emptyEntry, type AppState } from '../shared/types.ts';

test('points for delivering and for correct predictions', () => {
  const state: AppState = {
    members: [1, 2, 3].map((id) => ({ id, name: `m${id}`, active: true })),
    weeks: [{ id: 1, title: 'w', startDate: '2026-11-15', closed: true, notes: '' }],
    entries: [
      { ...emptyEntry(1, 1), outcome: 'done', excusePickId: 2, betPickId: 3 },
      { ...emptyEntry(1, 2), outcome: 'failed', excusePickId: 1, betPickId: 3 },
      { ...emptyEntry(1, 3), outcome: 'done', excusePickId: 2, betPickId: 1 },
    ],
  };
  const s = Object.fromEntries(computeStats(state).map((x) => [x.memberId, x]));
  assert.equal(s[1].points, 3 + 1 + 1);
  assert.equal(s[2].points, 0 + 0 + 1);
  assert.equal(s[3].points, 3 + 1 + 1);
  assert.equal(s[2].doubted, 2);
  assert.equal(s[3].backed, 2);
  assert.equal(s[1].streak, 1);
});
