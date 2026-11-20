export type Outcome = 'pending' | 'done' | 'partial' | 'failed';
export const OUTCOMES: readonly Outcome[] = ['pending', 'done', 'partial', 'failed'];

/**
 * A round is one week of the game.
 * - planning: players lock in a goal, an excuse call and a bet. Calls and bets stay secret.
 * - live: the week is under way. Calls and bets are revealed; players report how it went.
 * - final: results are locked and scored.
 */
export type RoundStatus = 'planning' | 'live' | 'final';
export const ROUND_STATUSES: readonly RoundStatus[] = ['planning', 'live', 'final'];

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
  title: string;
  notes: string;
  status: RoundStatus;
}

export interface Entry {
  roundId: number;
  playerId: number;
  goal: string;
  outcome: Outcome;
  /** The player's explanation when the goal wasn't fully met. */
  excuse: string;
  notes: string;
  /** Who this player thinks will come back with excuses. */
  excusePickId: number | null;
  excuseReason: string;
  /** Who this player bets will deliver. */
  betPickId: number | null;
  betReason: string;
  /** The player has locked in their move for the round. */
  submitted: boolean;
  /** Calls and bets are hidden from other players while the round is in planning. */
  hidden: boolean;
  /** Photos attached as proof, oldest first. */
  proofs: Proof[];
}

export type EntryPatch = Partial<
  Pick<Entry, 'goal' | 'outcome' | 'excuse' | 'notes' | 'excusePickId' | 'excuseReason' | 'betPickId' | 'betReason' | 'submitted'>
>;
export type RoundPatch = Partial<Pick<Round, 'title' | 'notes' | 'status' | 'startDate'>>;

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
  todo: 'submit' | 'report' | 'requests' | null;
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
    goal: '',
    outcome: 'pending',
    excuse: '',
    notes: '',
    excusePickId: null,
    excuseReason: '',
    betPickId: null,
    betReason: '',
    submitted: false,
    hidden: false,
    proofs: [],
  };
}
