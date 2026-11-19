export type Outcome = 'pending' | 'done' | 'partial' | 'failed';

export interface Member {
  id: number;
  name: string;
  active: boolean;
}

export interface Week {
  id: number;
  title: string;
  startDate: string; // YYYY-MM-DD
  closed: boolean;
}

/** One member's row for one week: their goal, their two predictions, and how it went. */
export interface Entry {
  weekId: number;
  memberId: number;
  /** ביצועים – what this member commits to doing this week. */
  goal: string;
  /** Result of the goal, set when the week is wrapped up. */
  outcome: Outcome;
  /** The excuse this member actually gave (if they didn't deliver). */
  excuse: string;
  /** תירוצים – who this member predicts will come back with excuses. */
  excusePickId: number | null;
  excuseReason: string;
  /** הימורים – who this member bets will deliver. */
  betPickId: number | null;
  betReason: string;
}

export type EntryPatch = Partial<Omit<Entry, 'weekId' | 'memberId'>>;

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
    excusePickId: null,
    excuseReason: '',
    betPickId: null,
    betReason: '',
  };
}
