import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { Link, navigate, type GameTab, type Route } from '../router.tsx';
import { GameProvider, useGame, useGameStore, useSession } from '../session.tsx';
import { AvatarStack, Button, EmptyState, Icon, Spinner, useCopy, type IconName } from '../ui.tsx';
import { HistoryPage } from './HistoryPage.tsx';
import { PlayerPage } from './PlayerPage.tsx';
import { PlayersPage } from './PlayersPage.tsx';
import { RoundPage } from './RoundPage.tsx';
import { SettingsPage } from './SettingsPage.tsx';
import { StandingsPage } from './StandingsPage.tsx';

export function GamePage({ route }: { route: Extract<Route, { name: 'game' }> }) {
  const store = useGameStore(route.gameId);
  const { refresh } = useSession();

  if (store.error) {
    const waiting = store.error.status === 403;
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={waiting ? 'clock' : 'x'}
          title={waiting ? 'Waiting for the admin' : 'Game not found'}
          action={
            waiting ? (
              <Button
                variant="ghost"
                onClick={async () => {
                  await api.cancelRequest(route.gameId);
                  await refresh();
                  navigate('/');
                }}
              >
                Cancel request
              </Button>
            ) : (
              <Link to="/" className="btn btn-secondary btn-md">
                Your games
              </Link>
            )
          }
        >
          {waiting ? 'Your request to join was sent. You’ll get in once an admin approves it.' : 'It may have been deleted, or you’re no longer a player.'}
        </EmptyState>
      </div>
    );
  }
  if (!store.state || !store.lookup) return <Spinner />;

  return (
    <GameProvider value={{ ...store, state: store.state, lookup: store.lookup }}>
      <GameShell tab={route.tab}>
        <GameTabContent route={route} />
      </GameShell>
    </GameProvider>
  );
}

function GameTabContent({ route }: { route: Extract<Route, { name: 'game' }> }) {
  switch (route.tab) {
    case 'round':
      return <RoundPage key={route.roundId ?? 'current'} roundId={route.roundId} />;
    case 'history':
      return <HistoryPage query={route.query ?? ''} />;
    case 'standings':
      return <StandingsPage />;
    case 'players':
      return route.playerId ? <PlayerPage key={route.playerId} playerId={route.playerId} /> : <PlayersPage />;
    case 'settings':
      return <SettingsPage />;
  }
}

const TABS: { tab: GameTab; label: string; icon: IconName; path: string }[] = [
  { tab: 'round', label: 'This week', icon: 'flag', path: '' },
  { tab: 'history', label: 'History', icon: 'history', path: '/history' },
  { tab: 'standings', label: 'Standings', icon: 'trophy', path: '/standings' },
  { tab: 'players', label: 'Players', icon: 'users', path: '/players' },
  { tab: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
];

function GameShell({ tab, children }: { tab: GameTab; children: ReactNode }) {
  const { state, lookup, gameId } = useGame();
  const copy = useCopy();
  const inviteUrl = state.game.inviteCode ? `${location.origin}/join/${state.game.inviteCode}` : null;

  return (
    <div className="page">
      <header className="game-header">
        <div className="game-header-main">
          <Link to="/" className="back-link">
            <Icon name="chevronLeft" size={16} /> Games
          </Link>
          <h1 className="display game-title" dir="auto">
            {state.game.name}
          </h1>
          <div className="game-header-meta">
            <AvatarStack players={lookup.active} max={8} size={30} />
            <span className="muted small">{lookup.active.length} players</span>
          </div>
        </div>
        {inviteUrl && (
          <Button icon="link" onClick={() => copy(inviteUrl, 'Invite link copied')}>
            Invite
          </Button>
        )}
      </header>

      <nav className="tabs" aria-label="Game">
        {TABS.map((t) => (
          <Link
            key={t.tab}
            to={`/g/${gameId}${t.path}`}
            className="tab"
            aria-current={t.tab === tab ? 'page' : undefined}
          >
            <Icon name={t.icon} size={17} />
            <span className="tab-label">{t.label}</span>
            {t.tab === 'players' && lookup.isAdmin && lookup.pending.length > 0 && <span className="badge">{lookup.pending.length}</span>}
          </Link>
        ))}
      </nav>

      <div className="tab-content">{children}</div>
    </div>
  );
}
