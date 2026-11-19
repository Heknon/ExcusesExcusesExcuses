import type { AppState, EntryPatch, Member, Week } from '../shared/types.ts';

const PASS_KEY = 'eee.passcode';

export function getPasscode(): string {
  try {
    return localStorage.getItem(PASS_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setPasscode(v: string) {
  try {
    localStorage.setItem(PASS_KEY, v);
  } catch {
    /* private mode – fine, ask again next time */
  }
}

export class UnauthorizedError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-team-passcode': getPasscode(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new UnauthorizedError('passcode');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  state: () => call<AppState>('GET', '/state'),
  addMember: (name: string) => call<Member>('POST', '/members', { name }),
  updateMember: (id: number, patch: Partial<Pick<Member, 'name' | 'active'>>) => call('PATCH', `/members/${id}`, patch),
  deleteMember: (id: number) => call('DELETE', `/members/${id}`),
  addWeek: (input: { title?: string; startDate: string; entries?: (EntryPatch & { memberId: number })[] }) =>
    call<Week>('POST', '/weeks', input),
  updateWeek: (id: number, patch: Partial<Pick<Week, 'title' | 'startDate' | 'closed'>>) => call('PATCH', `/weeks/${id}`, patch),
  deleteWeek: (id: number) => call('DELETE', `/weeks/${id}`),
  updateEntry: (weekId: number, memberId: number, patch: EntryPatch) =>
    call('PATCH', `/weeks/${weekId}/entries/${memberId}`, patch),
  removeEntry: (weekId: number, memberId: number) => call('DELETE', `/weeks/${weekId}/entries/${memberId}`),
};
