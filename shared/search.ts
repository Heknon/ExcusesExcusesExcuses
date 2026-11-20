import type { AppState, Entry, Week } from './types.ts';

export type SearchField = 'goal' | 'excuse' | 'notes' | 'excuseReason' | 'betReason' | 'weekTitle' | 'weekNotes';

export interface SearchHit {
  field: SearchField;
  text: string;
  week: Week;
  /** Absent for week-level hits. */
  entry?: Entry;
}

const ENTRY_FIELDS: SearchField[] = ['goal', 'excuse', 'notes', 'excuseReason', 'betReason'];

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

export function search(state: AppState, query: string, memberNames: Map<number, string>): SearchHit[] {
  if (!query.trim()) return [];
  const weeks = new Map(state.weeks.map((w) => [w.id, w]));
  const hits: SearchHit[] = [];

  for (const week of state.weeks) {
    if (week.title && matches(week.title, query)) hits.push({ field: 'weekTitle', text: week.title, week });
    if (week.notes && matches(week.notes, query)) hits.push({ field: 'weekNotes', text: week.notes, week });
  }
  for (const entry of state.entries) {
    const week = weeks.get(entry.weekId);
    if (!week) continue;
    const name = memberNames.get(entry.memberId) ?? '';
    for (const field of ENTRY_FIELDS) {
      const text = entry[field as keyof Entry] as string;
      if (text && entryMatches(text, name, query)) {
        hits.push({ field, text, week, entry });
      }
    }
  }
  return hits.sort((a, b) => b.week.startDate.localeCompare(a.week.startDate));
}
