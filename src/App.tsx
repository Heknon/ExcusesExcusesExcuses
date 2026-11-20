import { useEffect, useState, type FormEvent } from 'react';
import { setPasscode } from './api.ts';
import { EmptyState } from './components.tsx';
import { ImportPage } from './pages/ImportPage.tsx';
import { PeoplePage } from './pages/PeoplePage.tsx';
import { PersonPage } from './pages/PersonPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { StandingsPage } from './pages/StandingsPage.tsx';
import { WeekPage } from './pages/WeekPage.tsx';
import { WeeksPage } from './pages/WeeksPage.tsx';
import { Link, matchRoute, navigate, useLocation, type Route } from './router.tsx';
import { StoreContext, useAppStore } from './store.ts';

const NAV: { to: string; label: string; active: (r: Route) => boolean }[] = [
  { to: '/weeks', label: 'Weeks', active: (r) => r.name === 'weeks' || r.name === 'week' || r.name === 'home' },
  { to: '/people', label: 'People', active: (r) => r.name === 'people' || r.name === 'person' },
  { to: '/standings', label: 'Standings', active: (r) => r.name === 'standings' },
  { to: '/import', label: 'Import', active: (r) => r.name === 'import' },
];

export function App() {
  const store = useAppStore();
  const { path, params } = useLocation();
  const route = matchRoute(path, params);
  const latest = store.lookup.weeks[0];

  // "/" always shows the latest week.
  useEffect(() => {
    if (route.name === 'home' && store.status === 'ready') navigate(latest ? `/weeks/${latest.id}` : '/weeks', { replace: true });
  }, [route.name, store.status, latest]);

  if (store.status === 'locked') return <PasscodeGate onSubmit={store.reload} />;

  return (
    <StoreContext.Provider value={store}>
      <div className="shell">
        <header className="topbar">
          <Link to="/" className="brand">
            Excuses Excuses Excuses
          </Link>
          <nav className="nav" aria-label="Main">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="nav-link" aria-current={n.active(route) ? 'page' : undefined}>
                {n.label}
              </Link>
            ))}
          </nav>
          <SearchBox initial={route.name === 'search' ? route.query : ''} />
        </header>

        <main className="main">
          {store.status === 'loading' ? (
            <p className="muted">Loading…</p>
          ) : store.status === 'offline' ? (
            <EmptyState title="Can't reach the server">Check your connection and reload.</EmptyState>
          ) : (
            <Page route={route} />
          )}
        </main>

        {store.error && (
          <div className="toast" role="alert">
            <span>{store.error}</span>
            <button className="button-link" onClick={store.dismissError}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </StoreContext.Provider>
  );
}

function Page({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return null;
    case 'week':
      return <WeekPage key={route.id} id={route.id} />;
    case 'weeks':
      return <WeeksPage />;
    case 'people':
      return <PeoplePage />;
    case 'person':
      return <PersonPage key={route.id} id={route.id} />;
    case 'standings':
      return <StandingsPage />;
    case 'search':
      return <SearchPage query={route.query} />;
    case 'import':
      return <ImportPage />;
    case 'notFound':
      return <EmptyState title="Page not found" />;
  }
}

function SearchBox({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  useEffect(() => setQ(initial), [initial]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : '/search');
  };
  return (
    <form className="search" role="search" onSubmit={submit}>
      <input
        className="input"
        type="search"
        dir="auto"
        placeholder="Search goals, excuses, notes"
        aria-label="Search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
    </form>
  );
}

function PasscodeGate({ onSubmit }: { onSubmit: () => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="gate">
      <form
        className="gate-form"
        onSubmit={(e) => {
          e.preventDefault();
          setPasscode(value);
          onSubmit();
        }}
      >
        <h1 className="brand">Excuses Excuses Excuses</h1>
        <label>
          Team passcode
          <input className="input" type="password" value={value} autoFocus onChange={(e) => setValue(e.target.value)} />
        </label>
        <button className="button primary" type="submit">
          Continue
        </button>
      </form>
    </div>
  );
}
