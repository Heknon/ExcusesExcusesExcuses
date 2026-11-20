import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** Minimal history-API router: a dozen routes don't need a library. */

const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener('popstate', fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('popstate', fn);
  };
}

const snapshot = () => window.location.pathname + window.location.search;

export function navigate(to: string, { replace = false, keepScroll = false } = {}) {
  if (to === snapshot()) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  if (!keepScroll) window.scrollTo(0, 0);
  listeners.forEach((fn) => fn());
}

export type GameTab = 'round' | 'history' | 'standings' | 'players' | 'settings';

export type Route =
  | { name: 'home' }
  | { name: 'login'; next: string }
  | { name: 'join'; code: string }
  | { name: 'game'; gameId: number; tab: GameTab; roundId?: number; playerId?: number; query?: string }
  | { name: 'notFound' };

export function matchRoute(path: string, params: URLSearchParams): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const next = params.get('next') ?? '/';
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'login' || parts[0] === 'signup') return { name: 'login', next };
  if (parts[0] === 'join' && parts[1]) return { name: 'join', code: parts[1] };
  if (parts[0] === 'g' && /^\d+$/.test(parts[1] ?? '')) {
    const gameId = Number(parts[1]);
    const id = Number(parts[3]);
    switch (parts[2]) {
      case undefined:
        return { name: 'game', gameId, tab: 'round' };
      case 'rounds':
        return Number.isInteger(id) ? { name: 'game', gameId, tab: 'round', roundId: id } : { name: 'notFound' };
      case 'history':
        return { name: 'game', gameId, tab: 'history', query: params.get('q') ?? '' };
      case 'standings':
        return { name: 'game', gameId, tab: 'standings' };
      case 'players':
        return parts[3]
          ? Number.isInteger(id)
            ? { name: 'game', gameId, tab: 'players', playerId: id }
            : { name: 'notFound' }
          : { name: 'game', gameId, tab: 'players' };
      case 'settings':
        return { name: 'game', gameId, tab: 'settings' };
    }
  }
  return { name: 'notFound' };
}

export function useRoute(): Route {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, window.location.origin);
  return matchRoute(url.pathname, url.searchParams);
}

export function currentPath() {
  return snapshot();
}

export function Link({
  to,
  onClick,
  replace,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return <a href={to} onClick={handle} {...rest} />;
}
