import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, UnauthorizedError } from './api.ts';
import { emptyEntry, type AppState, type Entry, type EntryPatch, type Member, type Week, type WeekPatch } from '../shared/types.ts';

export type Status = 'loading' | 'ready' | 'locked' | 'offline';

const POLL_MS = 15_000;

function isEditing() {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
}

export function useAppStore() {
  const [state, setState] = useState<AppState>({ members: [], weeks: [], entries: [] });
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  /** Number of writes in flight; polling results are dropped while > 0 so they can't undo optimistic edits. */
  const pending = useRef(0);

  const reload = useCallback(async () => {
    try {
      const next = await api.state();
      if (pending.current === 0) setState(next);
      setStatus('ready');
    } catch (e) {
      if (e instanceof UnauthorizedError) setStatus('locked');
      else setStatus((s) => (s === 'ready' ? s : 'offline'));
    }
  }, []);

  useEffect(() => {
    reload();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !isEditing()) reload();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [reload]);

  /** Apply an optional optimistic update, run the request, then resync with the server. */
  const mutate = useCallback(
    async <T,>(request: () => Promise<T>, optimistic?: (s: AppState) => AppState): Promise<T | undefined> => {
      if (optimistic) setState(optimistic);
      pending.current++;
      try {
        const result = await request();
        setError('');
        return result;
      } catch (e) {
        if (e instanceof UnauthorizedError) setStatus('locked');
        else setError((e as Error).message);
        return undefined;
      } finally {
        pending.current--;
        await reload();
      }
    },
    [reload],
  );

  const patchEntry = useCallback(
    (weekId: number, memberId: number, patch: EntryPatch) =>
      mutate(
        () => api.updateEntry(weekId, memberId, patch),
        (s) => {
          const exists = s.entries.some((e) => e.weekId === weekId && e.memberId === memberId);
          const entries: Entry[] = exists
            ? s.entries.map((e) => (e.weekId === weekId && e.memberId === memberId ? { ...e, ...patch } : e))
            : [...s.entries, { ...emptyEntry(weekId, memberId), ...patch }];
          return { ...s, entries };
        },
      ),
    [mutate],
  );

  const patchWeek = useCallback(
    (id: number, patch: WeekPatch) =>
      mutate(
        () => api.updateWeek(id, patch),
        (s) => ({ ...s, weeks: s.weeks.map((w) => (w.id === id ? { ...w, ...patch } : w)) }),
      ),
    [mutate],
  );

  const lookup = useMemo(() => buildLookup(state), [state]);

  return { state, lookup, status, error, dismissError: () => setError(''), reload, mutate, patchEntry, patchWeek };
}

export interface Lookup {
  member: Map<number, Member>;
  name: (id: number | null | undefined) => string;
  week: Map<number, Week>;
  /** Newest first. */
  weeks: Week[];
  entriesByWeek: Map<number, Entry[]>;
  entriesByMember: Map<number, Entry[]>;
}

function buildLookup(state: AppState): Lookup {
  const member = new Map(state.members.map((m) => [m.id, m]));
  const weeks = [...state.weeks].sort((a, b) => b.startDate.localeCompare(a.startDate) || b.id - a.id);
  const entriesByWeek = new Map<number, Entry[]>();
  const entriesByMember = new Map<number, Entry[]>();
  for (const e of state.entries) {
    if (!member.has(e.memberId)) continue;
    (entriesByWeek.get(e.weekId) ?? entriesByWeek.set(e.weekId, []).get(e.weekId)!).push(e);
    (entriesByMember.get(e.memberId) ?? entriesByMember.set(e.memberId, []).get(e.memberId)!).push(e);
  }
  return {
    member,
    name: (id) => (id == null ? '' : member.get(id)?.name ?? 'Unknown'),
    week: new Map(state.weeks.map((w) => [w.id, w])),
    weeks,
    entriesByWeek,
    entriesByMember,
  };
}

export type Store = ReturnType<typeof useAppStore>;

export const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore outside StoreContext');
  return store;
}
