export type Outcome = 'pending' | 'done' | 'partial' | 'failed';

export const OUTCOMES: readonly Outcome[] = ['pending', 'done', 'partial', 'failed'];

export interface Member {
  id: number;
  name: string;
  active: boolean;
}

export interface Week {
  id: number;
  title: string;
  /** First day of the week (Sunday), YYYY-MM-DD. */
  startDate: string;
  closed: boolean;
  /** Free-form notes about the week as a whole. */
  notes: string;
}

/** One member's row for one week. */
export interface Entry {
  weekId: number;
  memberId: number;
  /** What the member commits to this week. */
  goal: string;
  outcome: Outcome;
  /** The member's explanation when the goal wasn't fully met. */
  excuse: string;
  /** Free-form notes: what happened, what was learned, follow-ups. */
  notes: string;
  /** Who this member predicts will come back with excuses. */
  excusePickId: number | null;
  excuseReason: string;
  /** Who this member bets will deliver. */
  betPickId: number | null;
  betReason: string;
}

export type EntryPatch = Partial<Omit<Entry, 'weekId' | 'memberId'>>;
export type WeekPatch = Partial<Pick<Week, 'title' | 'startDate' | 'closed' | 'notes'>>;
export type MemberPatch = Partial<Pick<Member, 'name' | 'active'>>;

export interface AppState {
  members: Member[];
  weeks: Week[];
  entries: Entry[];
}

export function emptyEntry(weekId: number, memberId: number): Entry {
  return {
    weekId,
    memberId,
    goal: '',
    outcome: 'pending',
    excuse: '',
    notes: '',
    excusePickId: null,
    excuseReason: '',
    betPickId: null,
    betReason: '',
  };
}
