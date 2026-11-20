import type { Entry, Outcome, Player, Round } from './types.ts';

export const POINTS = {
  done: 3,
  partial: 1,
  failed: 0,
  /** Called excuses on someone who then missed. */
  callHit: 1,
  /** Bet on the player the group voted most impressive. */
  betHit: 1,
  /** Voted most impressive by the group (ties share it). */
  mvp: 2,
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
  /** Rounds where the group voted this player most impressive. */
  mvps: number;
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

/**
 * Who the group voted most impressive in a round: everyone tied for the most votes.
 * Null when nobody voted (votes are hidden until a round is final, and older rounds predate voting).
 */
export function mvpWinners(entries: Entry[]): Set<number> | null {
  const votes = new Map<number, number>();
  for (const e of entries) if (e.mvpVoteId != null) votes.set(e.mvpVoteId, (votes.get(e.mvpVoteId) ?? 0) + 1);
  const top = Math.max(0, ...votes.values());
  if (!top) return null;
  return new Set([...votes].filter(([, n]) => n === top).map(([id]) => id));
}

export function mvpVotes(entries: Entry[]): Map<number, number> {
  const votes = new Map<number, number>();
  for (const e of entries) if (e.mvpVoteId != null) votes.set(e.mvpVoteId, (votes.get(e.mvpVoteId) ?? 0) + 1);
  return votes;
}

/** What scoring needs to know about a round as a whole. */
export interface RoundContext {
  outcomes: Map<number, Outcome>;
  winners: Set<number> | null;
}

export function roundContext(entries: Entry[]): RoundContext {
  return { outcomes: outcomesByPlayer(entries), winners: mvpWinners(entries) };
}

/** Whether a bet came true. Rounds without a vote fall back to the older rule: the pick delivered. */
export function betHit(betPickId: number | null, ctx: RoundContext): boolean | undefined {
  if (betPickId == null) return undefined;
  if (ctx.winners) return ctx.winners.has(betPickId);
  const o = ctx.outcomes.get(betPickId);
  return isResolved(o) ? o === 'done' : undefined;
}

/** Points one entry earned, given the rest of the round. */
export function entryPoints(entry: Entry, ctx: RoundContext): number {
  let points = isResolved(entry.outcome) ? POINTS[entry.outcome] : 0;
  if (entry.excusePickId != null && ctx.outcomes.get(entry.excusePickId) === 'failed') points += POINTS.callHit;
  if (betHit(entry.betPickId, ctx)) points += POINTS.betHit;
  if (ctx.winners?.has(entry.playerId)) points += POINTS.mvp;
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
        callHits: 0, calls: 0, betHits: 0, bets: 0, doubted: 0, backed: 0, streak: 0, mvps: 0,
      },
    ]),
  );
  const streakBroken = new Set<number>();
  const newestFirst = [...rounds].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);

  for (const round of newestFirst) {
    const roundEntries = entries.filter((e) => e.roundId === round.id);
    const ctx = roundContext(roundEntries);
    const { outcomes } = ctx;
    for (const id of ctx.winners ?? []) {
      const w = stats.get(id);
      if (w) w.mvps++;
    }

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
      const hit = betHit(e.betPickId, ctx);
      if (hit !== undefined) {
        s.bets++;
        if (hit) s.betHits++;
      }
      s.points += entryPoints(e, ctx);
    }
  }

  return [...stats.values()].sort((a, b) => b.points - a.points || b.done - a.done || a.playerId - b.playerId);
}
