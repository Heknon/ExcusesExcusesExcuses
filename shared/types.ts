export type Outcome = 'pending' | 'done' | 'partial' | 'failed';
export const OUTCOMES: readonly Outcome[] = ['pending', 'done', 'partial', 'failed'];

/**
 * A round is one week of the game, played the way the group does it sitting together:
 * - goals: everyone shares their goals; everyone sees them as they're written.
 * - bets:  goals are locked. Everyone picks who'll come back with excuses and who'll have the most
 *          impressive week. Picks stay secret until the admin reveals them.
 * - live:  the week is under way. Picks are revealed; players report each goal and vote (secretly)
 *          for the most impressive week.
 * - final: scored; votes are revealed.
 */
export type RoundStatus = 'goals' | 'bets' | 'live' | 'final';
export const ROUND_STATUSES: readonly RoundStatus[] = ['goals', 'bets', 'live', 'final'];
/** Phases where picks are still being made and stay hidden. */
export const isPrePlay = (s: RoundStatus) => s === 'goals' || s === 'bets';

export type Role = 'admin' | 'player';
export type PlayerStatus = 'pending' | 'active' | 'removed';

export type Locale = 'en' | 'he';
export const LOCALES: readonly Locale[] = ['en', 'he'];

export interface User {
  id: number;
  email: string;
  name: string;
  /** Null until the user picks a language; the client then follows the browser. */
  locale: Locale | null;
}

export interface Proof {
  id: number;
  createdAt: string;
}

export interface Game {
  id: number;
  name: string;
  /** Only sent to admins. */
  inviteCode: string | null;
  createdAt: string;
}

/** A seat in a game. Guests (no account) let an admin track people who haven't signed up yet. */
export interface Player {
  id: number;
  name: string;
  role: Role;
  status: PlayerStatus;
  hasAccount: boolean;
  isMe: boolean;
  /** Account email; only sent to admins, only for pending requests. */
  email?: string;
  joinedAt: string;
}

export interface Round {
  id: number;
  startDate: string; // YYYY-MM-DD, a Sunday
  /** When goals are due, ISO timestamp. */
  deadline: string;
  title: string;
  notes: string;
  status: RoundStatus;
}

export const MAX_GOALS = 5;
export const GOAL_MAX_LENGTH = 300;

export interface Goal {
  id: number;
  text: string;
  outcome: Outcome;
}

export interface Entry {
  roundId: number;
  playerId: number;
  /** In the player's order. */
  goals: Goal[];
  /** Derived from the goals' outcomes when there are any (see combineOutcomes). */
  outcome: Outcome;
  /** The player's explanation when the goal wasn't fully met. */
  excuse: string;
  notes: string;
  /** Who this player thinks will come back with excuses. */
  excusePickId: number | null;
  excuseReason: string;
  /** Who this player bets will have the most impressive week. */
  betPickId: number | null;
  betReason: string;
  /** This player's vote for the most impressive week. Hidden from others until the round is final. */
  mvpVoteId: number | null;
  /** Whether this player has voted (visible to everyone, so the admin can see who's missing). */
  voted: boolean;
  /** The player has locked in their move for the round. */
  submitted: boolean;
  /** Calls and bets are hidden from other players until the admin reveals them. */
  hidden: boolean;
  /** Photos attached as proof, oldest first. */
  proofs: Proof[];
}

export type EntryPatch = Partial<
  Pick<Entry, 'outcome' | 'excuse' | 'notes' | 'excusePickId' | 'excuseReason' | 'betPickId' | 'betReason' | 'submitted' | 'mvpVoteId'>
> & {
  /** The full goal list, in order. Goals keep their id (and outcome) when edited; omitted ones are deleted. */
  goals?: { id?: number; text: string }[];
  /** Report results per goal, by goal id. */
  goalOutcomes?: Record<number, Outcome>;
};
export type RoundPatch = Partial<Pick<Round, 'title' | 'notes' | 'status' | 'startDate' | 'deadline'>>;

export interface GameState {
  game: Game;
  me: { playerId: number; role: Role };
  players: Player[];
  rounds: Round[];
  entries: Entry[];
}

export interface GameSummary {
  id: number;
  name: string;
  role: Role;
  status: PlayerStatus;
  players: { id: number; name: string }[];
  round: { id: number; status: RoundStatus; startDate: string } | null;
  /** Something is waiting on this user: a move to lock in, a result to report, or (admins) join requests. */
  todo: 'goals' | 'bets' | 'report' | 'vote' | 'requests' | null;
  pendingRequests: number;
}

export interface Me {
  user: User;
  games: GameSummary[];
}

export function emptyEntry(roundId: number, playerId: number): Entry {
  return {
    roundId,
    playerId,
    goals: [],
    outcome: 'pending',
    excuse: '',
    notes: '',
    excusePickId: null,
    excuseReason: '',
    betPickId: null,
    betReason: '',
    mvpVoteId: null,
    voted: false,
    submitted: false,
    hidden: false,
    proofs: [],
  };
}
