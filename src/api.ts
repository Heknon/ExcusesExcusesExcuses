import type { EntryPatch, GameState, Locale, Me, Player, Proof, Round, RoundPatch, User } from '../shared/types.ts';

export class ApiError extends Error {
  status: number;
  /** Error code from shared/errors.ts; translate with useI18n().errorText. */
  code: string | undefined;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Fired when any request comes back 401, so the app can drop to the sign-in screen. */
export const onSignedOut = new EventTarget();

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) onSignedOut.dispatchEvent(new Event('signedout'));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.code);
  return data as T;
}

async function uploadImage<T>(path: string, blob: Blob): Promise<T> {
  const res = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) onSignedOut.dispatchEvent(new Event('signedout'));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Upload failed (${res.status})`, data.code);
  return data as T;
}

export interface ImportRow {
  name: string;
  goals: string[];
  excuseTarget: string;
  excuseReason: string;
  betTarget: string;
  betReason: string;
}

export const api = {
  signup: (input: { email: string; name: string; password: string; locale: Locale }) => call<{ user: User }>('POST', '/auth/signup', input),
  login: (input: { email: string; password: string }) => call<{ user: User }>('POST', '/auth/login', input),
  logout: () => call('POST', '/auth/logout'),
  me: () => call<Me>('GET', '/me'),
  updateProfile: (input: { name?: string; locale?: Locale }) => call<User>('PATCH', '/me', input),

  createGame: (name: string) => call<{ id: number }>('POST', '/games', { name }),
  lookupInvite: (code: string) =>
    call<{ id: number; name: string; players: number; status: Player['status'] | null }>('GET', `/invites/${encodeURIComponent(code)}`),
  requestJoin: (code: string) => call<{ id: number; status: 'pending' | 'active' }>('POST', `/invites/${encodeURIComponent(code)}`),
  cancelRequest: (gameId: number) => call('DELETE', `/games/${gameId}/request`),

  game: (id: number) => call<GameState>('GET', `/games/${id}`),
  updateGame: (id: number, input: { name?: string; regenerateCode?: boolean }) => call('PATCH', `/games/${id}`, input),
  deleteGame: (id: number) => call('DELETE', `/games/${id}`),
  leaveGame: (id: number) => call('POST', `/games/${id}/leave`),

  addGuest: (gameId: number, name: string) => call<{ id: number }>('POST', `/games/${gameId}/players`, { name }),
  playerAction: (
    gameId: number,
    playerId: number,
    input: { action: 'approve' | 'reject' | 'remove' | 'restore' | 'update'; guestId?: number; name?: string; role?: 'admin' | 'player' },
  ) => call<{ id: number }>('PATCH', `/games/${gameId}/players/${playerId}`, input),

  createRound: (gameId: number, startDate: string, deadline: string) => call<Round>('POST', `/games/${gameId}/rounds`, { startDate, deadline }),
  importRound: (gameId: number, input: { startDate: string; deadline: string; title: string; rows: ImportRow[] }) =>
    call<Round>('POST', `/games/${gameId}/rounds/import`, input),
  updateRound: (gameId: number, roundId: number, patch: RoundPatch) => call('PATCH', `/games/${gameId}/rounds/${roundId}`, patch),
  deleteRound: (gameId: number, roundId: number) => call('DELETE', `/games/${gameId}/rounds/${roundId}`),
  updateEntry: (gameId: number, roundId: number, playerId: number, patch: EntryPatch) =>
    call('PATCH', `/games/${gameId}/rounds/${roundId}/entries/${playerId}`, patch),
  removeEntry: (gameId: number, roundId: number, playerId: number) =>
    call('DELETE', `/games/${gameId}/rounds/${roundId}/entries/${playerId}`),

  addProof: (gameId: number, roundId: number, playerId: number, image: Blob) =>
    uploadImage<Proof>(`/games/${gameId}/rounds/${roundId}/entries/${playerId}/proofs`, image),
  deleteProof: (proofId: number) => call('DELETE', `/proofs/${proofId}`),
  proofUrl: (proofId: number) => `/api/proofs/${proofId}`,
};
