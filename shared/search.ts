import type { Entry, Goal, Round } from './types.ts';

export type SearchField = 'goal' | 'excuse' | 'notes' | 'excuseReason' | 'betReason' | 'roundTitle' | 'roundNotes';

export interface SearchHit {
  field: SearchField;
  text: string;
  round: Round;
  /** Absent for round-level hits. */
  entry?: Entry;
  /** Set for goal hits. */
  goal?: Goal;
}

const TEXT_FIELDS = ['excuse', 'notes', 'excuseReason', 'betReason'] as const;

const fold = (s: string) => s.toLocaleLowerCase().normalize('NFKD').replace(/[̀-֑ͯ-ׇ]/g, '');

const terms = (query: string) => fold(query).split(/\s+/).filter(Boolean);

/** Every term must appear somewhere in the text (case- and niqqud-insensitive). */
export function matches(text: string, query: string): boolean {
  const ts = terms(query);
  const hay = fold(text);
  return ts.length > 0 && ts.every((t) => hay.includes(t));
}

/**
 * Entry match: every term appears in the text or the author's name, and at least one
 * appears in the text itself — so "אלי ריצה" finds Eli's running goals, but "אלי" alone
 * doesn't return every field Eli ever wrote.
 */
function entryMatches(text: string, name: string, query: string): boolean {
  const ts = terms(query);
  const hay = fold(text);
  const who = fold(name);
  return ts.length > 0 && ts.every((t) => hay.includes(t) || who.includes(t)) && ts.some((t) => hay.includes(t));
}

export function search(
  data: { rounds: Round[]; entries: Entry[] },
  query: string,
  playerNames: Map<number, string>,
): SearchHit[] {
  if (!query.trim()) return [];
  const rounds = new Map(data.rounds.map((r) => [r.id, r]));
  const hits: SearchHit[] = [];

  for (const round of data.rounds) {
    if (round.title && matches(round.title, query)) hits.push({ field: 'roundTitle', text: round.title, round });
    if (round.notes && matches(round.notes, query)) hits.push({ field: 'roundNotes', text: round.notes, round });
  }
  for (const entry of data.entries) {
    const round = rounds.get(entry.roundId);
    if (!round) continue;
    const name = playerNames.get(entry.playerId) ?? '';
    for (const goal of entry.goals) {
      if (entryMatches(goal.text, name, query)) hits.push({ field: 'goal', text: goal.text, round, entry, goal });
    }
    for (const field of TEXT_FIELDS) {
      const text = entry[field];
      if (text && entryMatches(text, name, query)) hits.push({ field, text, round, entry });
    }
  }
  return hits.sort((a, b) => b.round.startDate.localeCompare(a.round.startDate));
}
