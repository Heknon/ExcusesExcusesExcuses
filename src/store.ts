import { useCallback, useEffect, useRef, useState } from 'react';
import { api, UnauthorizedError } from './api.ts';
import type { AppState, Entry, EntryPatch } from '../shared/types.ts';

export type Status = 'loading' | 'ready' | 'locked' | 'error';

export function useAppState() {
  const [state, setState] = useState<AppState>({ members: [], weeks: [], entries: [] });
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const busy = useRef(0);

  const reload = useCallback(async () => {
    try {
      const s = await api.state();
      if (busy.current === 0) setState(s);
      setStatus('ready');
    } catch (e) {
      if (e instanceof UnauthorizedError) setStatus('locked');
      else {
        setError((e as Error).message);
        setStatus((s) => (s === 'ready' ? s : 'error'));
      }
    }
  }, []);

  useEffect(() => {
    reload();
    // Keep teammates' edits flowing in, but never while someone is typing.
    const t = setInterval(() => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (document.visibilityState === 'visible' && !typing) reload();
    }, 15000);
    return () => clearInterval(t);
  }, [reload]);

  /** Run a mutation, then refresh from the server. */
  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      busy.current++;
      try {
        await fn();
        setError('');
      } catch (e) {
        if (e instanceof UnauthorizedError) setStatus('locked');
        else setError((e as Error).message);
      } finally {
        busy.current--;
        await reload();
      }
    },
    [reload],
  );

  const patchEntry = useCallback(
    (weekId: number, memberId: number, patch: EntryPatch) => {
      // Optimistic, so typing and clicking feel instant.
      setState((s) => {
        const exists = s.entries.some((e) => e.weekId === weekId && e.memberId === memberId);
        const base: Entry = {
          weekId, memberId, goal: '', outcome: 'pending', excuse: '',
          excusePickId: null, excuseReason: '', betPickId: null, betReason: '',
        };
        const entries = exists
          ? s.entries.map((e) => (e.weekId === weekId && e.memberId === memberId ? { ...e, ...patch } : e))
          : [...s.entries, { ...base, ...patch }];
        return { ...s, entries };
      });
      return run(() => api.updateEntry(weekId, memberId, patch));
    },
    [run],
  );

  return { state, status, error, setError, reload, run, patchEntry };
}

export type Store = ReturnType<typeof useAppState>;
