import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { I18nProvider, useI18n } from './i18n.tsx';
import { LanguageSwitch } from './LanguageSwitch.tsx';
import { AuthPage } from './pages/AuthPage.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { JoinPage } from './pages/JoinPage.tsx';
import { currentPath, Link, navigate, useRoute } from './router.tsx';
import { SessionProvider, useMe, useSession } from './session.tsx';
import { Avatar, Button, EmptyState, Icon, Modal, Spinner, ToastProvider, useToast } from './ui.tsx';

export function App() {
  return (
    <I18nProvider>
      <ToastProvider>
        <SessionProvider>
          <LocaleSync />
          <Routes />
        </SessionProvider>
      </ToastProvider>
    </I18nProvider>
  );
}

/** Follow the language saved on the account, once signed in. */
function LocaleSync() {
  const { state } = useSession();
  const { setLocale } = useI18n();
  const saved = state.status === 'signedIn' ? state.me.user.locale : null;
  useEffect(() => {
    if (saved) setLocale(saved);
  }, [saved, setLocale]);
  return null;
}

function Routes() {
  const route = useRoute();
  const { state } = useSession();
  const { t } = useI18n();
  const isAuthRoute = route.name === 'login';

  // Signed out: everything except the sign-in screen bounces to it, remembering where to come back to.
  useEffect(() => {
    if (state.status === 'signedOut' && !isAuthRoute) {
      const here = currentPath();
      navigate(here === '/' ? '/login' : `/login?next=${encodeURIComponent(here)}`, { replace: true });
    }
    if (state.status === 'signedIn' && isAuthRoute) navigate(route.next, { replace: true });
  }, [state.status, isAuthRoute, route]);

  if (state.status === 'loading') return <Spinner />;
  if (state.status === 'offline') {
    return (
      <div className="page page-narrow">
        <EmptyState icon="x" title={t.app.offlineTitle} action={<Button onClick={() => location.reload()}>{t.common.tryAgain}</Button>}>
          {t.app.offlineBody}
        </EmptyState>
      </div>
    );
  }
  if (isAuthRoute) return state.status === 'signedOut' ? <AuthPage next={route.next} /> : <Spinner />;
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
            <EmptyState
              icon="x"
              title={t.app.notFound}
              action={
                <Link to="/" className="btn btn-secondary btn-md">
                  {t.common.yourGames}
                </Link>
              }
            />
          </div>
        )}
      </main>
    </>
  );
}

function TopBar() {
  const me = useMe();
  const { signOut, refresh } = useSession();
  const { t, errorText } = useI18n();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(me.user.name);
  const menuRef = useRef<HTMLDivElement>(null);
  const todos = me.games.filter((g) => g.todo).length;

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const saveName = async () => {
    try {
      await api.updateProfile({ name });
      await refresh();
      toast(t.app.nameUpdated);
      setEditing(false);
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <header className="topbar">
      <Link to="/" className="wordmark">
        {t.wordmark}
        <span>³</span>
      </Link>
      <div className="topbar-right" ref={menuRef}>
        <Link to="/" className="topbar-games">
          {t.common.games}
          {todos > 0 && <span className="badge">{todos}</span>}
        </Link>
        <button className="account-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t.app.account}>
          <Avatar id={me.user.id} name={me.user.name} size={34} />
        </button>
        {open && (
          <div className="menu menu-account" role="menu">
            <div className="menu-head">
              <b dir="auto">{me.user.name}</b>
              <span className="muted small">{me.user.email}</span>
            </div>
            <div className="menu-row">
              <span>
                <Icon name="globe" size={16} /> {t.language}
              </span>
              <LanguageSwitch />
            </div>
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setName(me.user.name);
                setEditing(true);
              }}
            >
              <Icon name="edit" size={16} /> {t.app.changeName}
            </button>
            <button role="menuitem" onClick={signOut}>
              <Icon name="logout" size={16} /> {t.app.signOut}
            </button>
          </div>
        )}
      </div>
      {editing && (
        <Modal
          title={t.app.yourName}
          onClose={() => setEditing(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>
                {t.common.cancel}
              </Button>
              <Button variant="primary" disabled={!name.trim()} onClick={saveName}>
                {t.common.save}
              </Button>
            </>
          }
        >
          <label className="field">
            <span className="field-label">{t.app.yourNameHint}</span>
            <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoFocus />
          </label>
        </Modal>
      )}
    </header>
  );
}
