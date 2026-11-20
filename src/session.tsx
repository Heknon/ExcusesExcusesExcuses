import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, onSignedOut } from './api.ts';
import type { Entry, GameState, Me, Player, Round } from '../shared/types.ts';
import { useI18n } from './i18n.tsx';
import { useToast } from './ui.tsx';

/* ---------- session ---------- */

type SessionState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; me: Me } | { status: 'offline' };

interface Session {
  state: SessionState;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'signedIn', me: await api.me() });
    } catch (e) {
      setState(e instanceof ApiError && e.status === 401 ? { status: 'signedOut' } : { status: 'offline' });
    }
  }, []);

  useEffect(() => {
    refresh();
    const onOut = () => setState({ status: 'signedOut' });
    onSignedOut.addEventListener('signedout', onOut);
    return () => onSignedOut.removeEventListener('signedout', onOut);
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.logout().catch(() => {});
    setState({ status: 'signedOut' });
  }, []);

  return <SessionContext.Provider value={{ state, refresh, signOut }}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

export function useMe(): Me {
  const { state } = useSession();
  if (state.status !== 'signedIn') throw new Error('useMe while signed out');
  return state.me;
}

/* ---------- game ---------- */

const POLL_MS = 10_000;

function isEditing() {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

export interface GameLookup {
  player: Map<number, Player>;
  name: (id: number | null | undefined) => string;
  /** Active players, in seat order. */
  active: Player[];
  pending: Player[];
  me: Player;
  isAdmin: boolean;
  /** Newest first. */
  rounds: Round[];
  round: Map<number, Round>;
  current: Round | undefined;
  entriesByRound: Map<number, Entry[]>;
  entriesByPlayer: Map<number, Entry[]>;
}

function buildLookup(s: GameState): GameLookup {
  const player = new Map(s.players.map((p) => [p.id, p]));
  const group = <K,>(key: (e: Entry) => K) => {
    const m = new Map<K, Entry[]>();
    for (const e of s.entries) {
      const k = key(e);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return m;
  };
  return {
    player,
    name: (id) => (id == null ? '' : player.get(id)?.name ?? '—'),
    active: s.players.filter((p) => p.status === 'active'),
    pending: s.players.filter((p) => p.status === 'pending'),
    me: player.get(s.me.playerId)!,
    isAdmin: s.me.role === 'admin',
    rounds: s.rounds,
    round: new Map(s.rounds.map((r) => [r.id, r])),
    current: s.rounds[0],
    entriesByRound: group((e) => e.roundId),
    entriesByPlayer: group((e) => e.playerId),
  };
}

export interface GameStore {
  gameId: number;
  state: GameState | null;
  lookup: GameLookup | null;
  error: ApiError | null;
  reload: () => Promise<void>;
  /** Run a write, report failures as a toast, then resync. Resolves to the result or undefined on failure. */
  run: <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
  /** Optimistically patch local state (e.g. while typing is saved). */
  patchLocal: (fn: (s: GameState) => GameState) => void;
}

export function useGameStore(gameId: number): GameStore {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const writes = useRef(0);
  const toast = useToast();
  const { errorText } = useI18n();
  const { refresh } = useSession();

  const reload = useCallback(async () => {
    try {
      const next = await api.game(gameId);
      if (writes.current === 0) setState(next);
      setError(null);
    } catch (e) {
      if (e instanceof ApiError) setError(e);
    }
  }, [gameId]);

  useEffect(() => {
    setState(null);
    setError(null);
    reload();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible' && !isEditing() && !document.querySelector('dialog[open]')) reload();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [reload]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, success?: string) => {
      writes.current++;
      try {
        const out = await fn();
        if (success) toast(success);
        return out;
      } catch (e) {
        toast(errorText(e), 'error');
        return undefined;
      } finally {
        writes.current--;
        await reload();
        refresh(); // keep the home screen's to-dos in sync
      }
    },
    [reload, refresh, toast, errorText],
  );

  const lookup = useMemo(() => (state ? buildLookup(state) : null), [state]);
  const patchLocal = useCallback((fn: (s: GameState) => GameState) => setState((s) => (s ? fn(s) : s)), []);

  return { gameId, state, lookup, error, reload, run, patchLocal };
}

const GameContext = createContext<(GameStore & { state: GameState; lookup: GameLookup }) | null>(null);
export const GameProvider = GameContext.Provider;

export function useGame() {
  const g = useContext(GameContext);
  if (!g) throw new Error('useGame outside GameProvider');
  return g;
}
