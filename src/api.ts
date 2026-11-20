import type { AppState, EntryPatch, Member, MemberPatch, Week, WeekPatch } from '../shared/types.ts';

const PASSCODE_KEY = 'eee.passcode';

export function getPasscode(): string {
  try {
    return localStorage.getItem(PASSCODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setPasscode(value: string) {
  try {
    localStorage.setItem(PASSCODE_KEY, value);
  } catch {
    // Storage unavailable (private mode): the user is asked again next visit.
  }
}

export class UnauthorizedError extends Error {}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-team-passcode': getPasscode() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new UnauthorizedError('Passcode required');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export type NewWeek = { title?: string; startDate: string; entries?: (EntryPatch & { memberId: number })[] };

export const api = {
  state: () => call<AppState>('GET', '/state'),
  addMember: (name: string) => call<Member>('POST', '/members', { name }),
  updateMember: (id: number, patch: MemberPatch) => call('PATCH', `/members/${id}`, patch),
  deleteMember: (id: number) => call('DELETE', `/members/${id}`),
  addWeek: (input: NewWeek) => call<Week>('POST', '/weeks', input),
  updateWeek: (id: number, patch: WeekPatch) => call('PATCH', `/weeks/${id}`, patch),
  deleteWeek: (id: number) => call('DELETE', `/weeks/${id}`),
  updateEntry: (weekId: number, memberId: number, patch: EntryPatch) =>
    call('PATCH', `/weeks/${weekId}/entries/${memberId}`, patch),
  removeEntry: (weekId: number, memberId: number) => call('DELETE', `/weeks/${weekId}/entries/${memberId}`),
};
