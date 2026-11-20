import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/** Minimal history-API router: the app has a handful of routes, so no library. */

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

export function navigate(to: string, { replace = false } = {}) {
  if (to === snapshot()) return;
  if (replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  window.scrollTo(0, 0);
  listeners.forEach((fn) => fn());
}

export function useLocation() {
  const href = useSyncExternalStore(subscribe, snapshot);
  const url = new URL(href, window.location.origin);
  return { path: url.pathname, params: url.searchParams };
}

export type Route =
  | { name: 'home' }
  | { name: 'week'; id: number }
  | { name: 'weeks' }
  | { name: 'people' }
  | { name: 'person'; id: number }
  | { name: 'standings' }
  | { name: 'search'; query: string }
  | { name: 'import' }
  | { name: 'notFound' };

export function matchRoute(path: string, params: URLSearchParams): Route {
  const parts = path.split('/').filter(Boolean);
  const id = Number(parts[1]);
  switch (parts[0]) {
    case undefined:
      return { name: 'home' };
    case 'weeks':
      return parts[1] ? (Number.isInteger(id) ? { name: 'week', id } : { name: 'notFound' }) : { name: 'weeks' };
    case 'people':
      return parts[1] ? (Number.isInteger(id) ? { name: 'person', id } : { name: 'notFound' }) : { name: 'people' };
    case 'standings':
      return { name: 'standings' };
    case 'search':
      return { name: 'search', query: params.get('q') ?? '' };
    case 'import':
      return { name: 'import' };
    default:
      return { name: 'notFound' };
  }
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}
