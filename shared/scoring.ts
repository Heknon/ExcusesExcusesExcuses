import type { AppState, Entry, Outcome } from './types.ts';

export const POINTS = {
  done: 3,
  partial: 1,
  failed: 0,
  /** Called excuses on someone who then missed. */
  callHit: 1,
  /** Bet on someone who then delivered. */
  betHit: 1,
} as const;

export interface MemberStats {
  memberId: number;
  points: number;
  /** Weeks with a recorded outcome. */
  weeks: number;
  done: number;
  partial: number;
  failed: number;
  callHits: number;
  calls: number;
  betHits: number;
  bets: number;
  /** Times others called excuses on this member. */
  doubted: number;
  /** Times others bet on this member. */
  backed: number;
  /** Consecutive most-recent resolved weeks marked done. */
  streak: number;
}

export const isResolved = (o: Outcome | undefined): o is Exclude<Outcome, 'pending'> => !!o && o !== 'pending';

export function ratio(hits: number, total: number): number | null {
  return total ? hits / total : null;
}

/** Points one entry earned, given everyone's outcomes that week. */
export function entryPoints(entry: Entry, outcomes: Map<number, Outcome>): number {
  let points = isResolved(entry.outcome) ? POINTS[entry.outcome] : 0;
  if (entry.excusePickId != null && outcomes.get(entry.excusePickId) === 'failed') points += POINTS.callHit;
  if (entry.betPickId != null && outcomes.get(entry.betPickId) === 'done') points += POINTS.betHit;
  return points;
}

export function outcomesByMember(entries: Entry[]): Map<number, Outcome> {
  return new Map(entries.map((e) => [e.memberId, e.outcome]));
}

export function computeStats(state: AppState): MemberStats[] {
  const stats = new Map<number, MemberStats>(
    state.members.map((m) => [
      m.id,
      {
        memberId: m.id, points: 0, weeks: 0, done: 0, partial: 0, failed: 0,
        callHits: 0, calls: 0, betHits: 0, bets: 0, doubted: 0, backed: 0, streak: 0,
      },
    ]),
  );
  const streakBroken = new Set<number>();
  const newestFirst = [...state.weeks].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);

  for (const week of newestFirst) {
    const entries = state.entries.filter((e) => e.weekId === week.id);
    const outcomes = outcomesByMember(entries);

    for (const e of entries) {
      const s = stats.get(e.memberId);
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
        s.weeks++;
        s[e.outcome]++;
        if (!streakBroken.has(e.memberId)) {
          if (e.outcome === 'done') s.streak++;
          else streakBroken.add(e.memberId);
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

  return [...stats.values()].sort((a, b) => b.points - a.points || b.done - a.done);
}
