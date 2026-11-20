import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { AuthPage } from './pages/AuthPage.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { JoinPage } from './pages/JoinPage.tsx';
import { currentPath, Link, navigate, useRoute } from './router.tsx';
import { SessionProvider, useMe, useSession } from './session.tsx';
import { Avatar, Button, EmptyState, Icon, Modal, Spinner, ToastProvider, useToast } from './ui.tsx';

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <Routes />
      </SessionProvider>
    </ToastProvider>
  );
}

function Routes() {
  const route = useRoute();
  const { state } = useSession();
  const isAuthRoute = route.name === 'login' || route.name === 'signup';

  // Signed out: everything except the auth screens bounces to sign-in, remembering where to come back to.
  useEffect(() => {
    if (state.status === 'signedOut' && !isAuthRoute) {
      const here = currentPath();
      // Invite links go straight to sign-up: the person is most likely new.
      const target = route.name === 'join' ? '/signup' : '/login';
      navigate(here === '/' ? target : `${target}?next=${encodeURIComponent(here)}`, { replace: true });
    }
    if (state.status === 'signedIn' && isAuthRoute) navigate(route.next, { replace: true });
  }, [state.status, isAuthRoute, route]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'offline') {
    return (
      <div className="page page-narrow">
        <EmptyState icon="x" title="Can’t reach the server" action={<Button onClick={() => location.reload()}>Try again</Button>}>
          Check your connection.
        </EmptyState>
      </div>
    );
  }
  if (isAuthRoute) return state.status === 'signedOut' ? <AuthPage mode={route.name} next={route.next} /> : <Spinner />;
  if (state.status !== 'signedIn') return <Spinner />;

  return (
    <>
      <TopBar />
      <main>
        {route.name === 'home' && <HomePage />}
        {route.name === 'join' && <JoinPage key={route.code} code={route.code} />}
        {route.name === 'game' && <GamePage key={route.gameId} route={route} />}
        {route.name === 'notFound' && (
          <div className="page page-narrow">
            <EmptyState icon="x" title="Page not found" action={<Link to="/" className="btn btn-secondary btn-md">Your games</Link>} />
          </div>
        )}
      </main>
    </>
  );
}

function TopBar() {
  const me = useMe();
  const { signOut, refresh } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.user.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const todos = me.games.filter((g) => g.todo).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const saveName = async () => {
    try {
      await api.updateProfile({ name });
      await refresh();
      toast('Name updated');
      setEditing(false);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <header className="topbar">
      <Link to="/" className="wordmark">
        Excuses<span>³</span>
      </Link>
      <div className="topbar-right" ref={menuRef}>
        <Link to="/" className="topbar-games">
          Games
          {todos > 0 && <span className="badge">{todos}</span>}
        </Link>
        <button className="account-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Account">
          <Avatar id={me.user.id} name={me.user.name} size={32} />
        </button>
        {open && (
          <div className="menu menu-account" role="menu">
            <div className="menu-head">
              <b dir="auto">{me.user.name}</b>
              <span className="muted small">{me.user.email}</span>
            </div>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setName(me.user.name);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={16} /> Change name
            </button>
            <button role="menuitem" onClick={signOut}>
              <Icon name="logout" size={16} /> Sign out
            </button>
          </div>
        )}
      </div>
      {editing && (
        <Modal
          title="Your name"
          onClose={() => setEditing(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!name.trim()} onClick={saveName}>
                Save
              </Button>
            </>
          }
        >
          <label className="field">
            <span className="field-label">Shown on new games you create or join</span>
            <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
          </label>
        </Modal>
      )}
    </header>
  );
}
