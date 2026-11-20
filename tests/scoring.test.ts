import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineOutcomes, computeStats, entryPoints, mvpWinners, roundContext } from '../shared/scoring.ts';
import { emptyEntry, type Player, type Round } from '../shared/types.ts';

const player = (id: number): Player => ({
  id, name: `p${id}`, role: 'player', status: 'active', hasAccount: true, isMe: false, joinedAt: '',
});

test('points for delivering and for correct predictions', () => {
  const rounds: Round[] = [{ id: 1, title: '', notes: '', startDate: '2026-11-15', deadline: '', status: 'final' }];
  const entries = [
    { ...emptyEntry(1, 1), outcome: 'done' as const, excusePickId: 2, betPickId: 3 },
    { ...emptyEntry(1, 2), outcome: 'failed' as const, excusePickId: 1, betPickId: 3 },
    { ...emptyEntry(1, 3), outcome: 'done' as const, excusePickId: 2, betPickId: 1 },
  ];
  const s = Object.fromEntries(computeStats([1, 2, 3].map(player), rounds, entries).map((x) => [x.playerId, x]));
  assert.equal(s[1].points, 3 + 1 + 1);
  assert.equal(s[2].points, 0 + 0 + 1);
  assert.equal(s[3].points, 3 + 1 + 1);
  assert.equal(s[2].doubted, 2);
  assert.equal(s[3].backed, 2);
  assert.equal(s[1].streak, 1);
});

test('a week’s result follows its goals', () => {
  assert.equal(combineOutcomes([]), 'pending');
  assert.equal(combineOutcomes(['done', 'pending']), 'pending');
  assert.equal(combineOutcomes(['done', 'done']), 'done');
  assert.equal(combineOutcomes(['failed', 'failed']), 'failed');
  assert.equal(combineOutcomes(['done', 'failed']), 'partial');
  assert.equal(combineOutcomes(['partial']), 'partial');
});

test('the most impressive vote: winners, bets on them, and the +2', () => {
  const rounds: Round[] = [{ id: 1, title: '', notes: '', startDate: '2026-11-15', deadline: '', status: 'final' }];
  const entries = [
    { ...emptyEntry(1, 1), outcome: 'done' as const, betPickId: 2, mvpVoteId: 2 },
    { ...emptyEntry(1, 2), outcome: 'done' as const, betPickId: 3, mvpVoteId: 3 },
    { ...emptyEntry(1, 3), outcome: 'failed' as const, betPickId: 1, mvpVoteId: 2 },
  ];
  assert.deepEqual([...mvpWinners(entries)!], [2]);
  const ctx = roundContext(entries);
  assert.equal(entryPoints(entries[0], ctx), 3 + 1, 'done + bet on the winner');
  assert.equal(entryPoints(entries[1], ctx), 3 + 2, 'done + most impressive; bet on 3 missed');
  assert.equal(entryPoints(entries[2], ctx), 0, 'bet on 1, who did deliver but didn’t win the vote');
  const s = Object.fromEntries(computeStats([1, 2, 3].map(player), rounds, entries).map((x) => [x.playerId, x]));
  assert.equal(s[2].mvps, 1);
  assert.equal(s[1].betHits, 1);

  // Ties share it; no votes means no winners.
  assert.deepEqual([...mvpWinners([{ ...emptyEntry(1, 1), mvpVoteId: 2 }, { ...emptyEntry(1, 2), mvpVoteId: 1 }])!].sort(), [1, 2]);
  assert.equal(mvpWinners([emptyEntry(1, 1)]), null);
});
