import type { AppState, Entry, Outcome } from './types.ts';

export const POINTS = {
  done: 3,
  partial: 1,
  failed: 0,
  /** Predicted someone would come back with excuses, and they did. */
  excuseHit: 1,
  /** Bet that someone would deliver, and they did. */
  betHit: 1,
} as const;

export interface MemberStats {
  memberId: number;
  points: number;
  weeks: number;
  done: number;
  partial: number;
  failed: number;
  excuseHits: number;
  excuseCalls: number;
  betHits: number;
  betCalls: number;
  /** How many times others predicted this member would make excuses. */
  doubtedBy: number;
  /** How many times others bet on this member. */
  backedBy: number;
  /** Current run of consecutive "done" weeks, most recent first. */
  streak: number;
}

const resolved = (o: Outcome) => o !== 'pending';

export function weekPoints(entry: Entry, outcomes: Map<number, Outcome>): number {
  let p = 0;
  if (resolved(entry.outcome)) p += POINTS[entry.outcome as 'done' | 'partial' | 'failed'];
  if (entry.excusePickId != null && outcomes.get(entry.excusePickId) === 'failed') p += POINTS.excuseHit;
  if (entry.betPickId != null && outcomes.get(entry.betPickId) === 'done') p += POINTS.betHit;
  return p;
}

export function computeStats(state: AppState): MemberStats[] {
  const stats = new Map<number, MemberStats>();
  for (const m of state.members) {
    stats.set(m.id, {
      memberId: m.id, points: 0, weeks: 0, done: 0, partial: 0, failed: 0,
      excuseHits: 0, excuseCalls: 0, betHits: 0, betCalls: 0,
      doubtedBy: 0, backedBy: 0, streak: 0,
    });
  }

  const weeksSorted = [...state.weeks].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);
  const streakOpen = new Set(state.members.map((m) => m.id));

  for (const week of weeksSorted) {
    const entries = state.entries.filter((e) => e.weekId === week.id);
    const outcomes = new Map(entries.map((e) => [e.memberId, e.outcome]));
    for (const e of entries) {
      const s = stats.get(e.memberId);
      if (!s) continue;
      if (e.excusePickId != null) stats.get(e.excusePickId) && stats.get(e.excusePickId)!.doubtedBy++;
      if (e.betPickId != null) stats.get(e.betPickId) && stats.get(e.betPickId)!.backedBy++;

      if (resolved(e.outcome)) {
        s.weeks++;
        s[e.outcome as 'done' | 'partial' | 'failed']++;
        if (streakOpen.has(e.memberId)) {
          if (e.outcome === 'done') s.streak++;
          else streakOpen.delete(e.memberId);
        }
      }
      const exTarget = e.excusePickId != null ? outcomes.get(e.excusePickId) : undefined;
      if (exTarget && resolved(exTarget)) {
        s.excuseCalls++;
        if (exTarget === 'failed') s.excuseHits++;
      }
      const betTarget = e.betPickId != null ? outcomes.get(e.betPickId) : undefined;
      if (betTarget && resolved(betTarget)) {
        s.betCalls++;
        if (betTarget === 'done') s.betHits++;
      }
      s.points += weekPoints(e, outcomes);
    }
  }

  return [...stats.values()].sort((a, b) => b.points - a.points || b.done - a.done);
}
