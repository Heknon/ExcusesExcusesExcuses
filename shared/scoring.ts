import type { Entry, Outcome, Player, Round } from './types.ts';

export const POINTS = {
  done: 3,
  partial: 1,
  failed: 0,
  /** Called excuses on someone who then missed. */
  callHit: 1,
  /** Bet on someone who then delivered. */
  betHit: 1,
} as const;

export interface PlayerStats {
  playerId: number;
  points: number;
  /** Rounds with a recorded outcome. */
  rounds: number;
  done: number;
  partial: number;
  failed: number;
  callHits: number;
  calls: number;
  betHits: number;
  bets: number;
  /** Times others called excuses on this player. */
  doubted: number;
  /** Times others bet on this player. */
  backed: number;
  /** Consecutive most-recent resolved rounds marked done. */
  streak: number;
}

/**
 * A player's result for the week from their goals' results:
 * all done → done, all missed → failed, anything else fully reported → partial.
 * Stays pending until every goal is reported.
 */
export function combineOutcomes(outcomes: Outcome[]): Outcome {
  if (!outcomes.length || outcomes.some((o) => o === 'pending')) return 'pending';
  if (outcomes.every((o) => o === 'done')) return 'done';
  if (outcomes.every((o) => o === 'failed')) return 'failed';
  return 'partial';
}

export const isResolved = (o: Outcome | undefined): o is Exclude<Outcome, 'pending'> => !!o && o !== 'pending';

export function ratio(hits: number, total: number): number | null {
  return total ? hits / total : null;
}

export function outcomesByPlayer(entries: Entry[]): Map<number, Outcome> {
  return new Map(entries.map((e) => [e.playerId, e.outcome]));
}

/** Points one entry earned, given everyone's outcomes that round. */
export function entryPoints(entry: Entry, outcomes: Map<number, Outcome>): number {
  let points = isResolved(entry.outcome) ? POINTS[entry.outcome] : 0;
  if (entry.excusePickId != null && outcomes.get(entry.excusePickId) === 'failed') points += POINTS.callHit;
  if (entry.betPickId != null && outcomes.get(entry.betPickId) === 'done') points += POINTS.betHit;
  return points;
}

/**
 * Totals per player. Only rounds passed in count, so callers decide whether
 * in-progress rounds are included (standings use final rounds only).
 */
export function computeStats(players: Player[], rounds: Round[], entries: Entry[]): PlayerStats[] {
  const stats = new Map<number, PlayerStats>(
    players.map((p) => [
      p.id,
      {
        playerId: p.id, points: 0, rounds: 0, done: 0, partial: 0, failed: 0,
        callHits: 0, calls: 0, betHits: 0, bets: 0, doubted: 0, backed: 0, streak: 0,
      },
    ]),
  );
  const streakBroken = new Set<number>();
  const newestFirst = [...rounds].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);

  for (const round of newestFirst) {
    const roundEntries = entries.filter((e) => e.roundId === round.id);
    const outcomes = outcomesByPlayer(roundEntries);

    for (const e of roundEntries) {
      const s = stats.get(e.playerId);
      if (!s) continue;
      if (e.excusePickId != null) {
        const target = stats.get(e.excusePickId);
        if (target) target.doubted++;
      }
      if (e.betPickId != null) {
        const target = stats.get(e.betPickId);
        if (target) target.backed++;
      }

      if (isResolved(e.outcome)) {
        s.rounds++;
        s[e.outcome]++;
        if (!streakBroken.has(e.playerId)) {
          if (e.outcome === 'done') s.streak++;
          else streakBroken.add(e.playerId);
        }
      }

      const called = e.excusePickId != null ? outcomes.get(e.excusePickId) : undefined;
      if (isResolved(called)) {
        s.calls++;
        if (called === 'failed') s.callHits++;
      }
      const backed = e.betPickId != null ? outcomes.get(e.betPickId) : undefined;
      if (isResolved(backed)) {
        s.bets++;
        if (backed === 'done') s.betHits++;
      }
      s.points += entryPoints(e, outcomes);
    }
  }

  return [...stats.values()].sort((a, b) => b.points - a.points || b.done - a.done || a.playerId - b.playerId);
}
