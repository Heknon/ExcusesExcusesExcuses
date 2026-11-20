import { ERRORS } from '../shared/errors.ts';
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

/** POST an Auth.js action with its CSRF token; Auth.js answers with the URL to go to next. */
async function authAction(action: string, form: Record<string, string>): Promise<string> {
  const csrf = await fetch('/api/auth/csrf').then((r) => r.json()).catch(() => ({}));
  const res = await fetch(`/api/auth/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1' },
    body: new URLSearchParams({ ...form, csrfToken: csrf.csrfToken ?? '' }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.url !== 'string') throw new ApiError(res.status, ERRORS.server_error, 'server_error');
  return data.url;
}

async function addProof(gameId: number, roundId: number, playerId: number, image: Blob): Promise<Proof> {
  const entry = `/games/${gameId}/rounds/${roundId}/entries/${playerId}/proofs`;
  const upload = await call<{ key: string; url: string; headers: Record<string, string> }>('POST', `${entry}/uploads`, {
    type: image.type || 'image/jpeg',
  });
  const put = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: image }).catch(() => null);
  if (!put?.ok) throw new ApiError(put?.status ?? 0, ERRORS.proof_upload_failed, 'proof_upload_failed');
  return call<Proof>('POST', entry, { key: upload.key });
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
  signInWithGoogle: async (next: string) => location.assign(await authAction('signin/google', { callbackUrl: next })),
  signOut: () => authAction('signout', { callbackUrl: '/' }),
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

  addProof,
  deleteProof: (proofId: number) => call('DELETE', `/proofs/${proofId}`),
  proofUrl: (proofId: number) => `/api/proofs/${proofId}`,
};
