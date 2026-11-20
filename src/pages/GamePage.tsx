import type { ReactNode } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
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
  const { t } = useI18n();

  if (store.error) {
    const waiting = store.error.status === 403;
    return (
      <div className="page page-narrow">
        <EmptyState
          icon={waiting ? 'clock' : 'x'}
          title={waiting ? t.game.waitingTitle : t.game.notFoundTitle}
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
                {t.home.cancelRequest}
              </Button>
            ) : (
              <Link to="/" className="btn btn-secondary btn-md">
                {t.common.yourGames}
              </Link>
            )
          }
        >
          {waiting ? t.game.waitingBody : t.game.notFoundBody}
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

const TABS: { tab: GameTab; icon: IconName; path: string }[] = [
  { tab: 'round', icon: 'flag', path: '' },
  { tab: 'history', icon: 'history', path: '/history' },
  { tab: 'standings', icon: 'trophy', path: '/standings' },
  { tab: 'players', icon: 'users', path: '/players' },
  { tab: 'settings', icon: 'settings', path: '/settings' },
];

function GameShell({ tab, children }: { tab: GameTab; children: ReactNode }) {
  const { state, lookup, gameId } = useGame();
  const { t } = useI18n();
  const copy = useCopy();
  const inviteUrl = state.game.inviteCode ? `${location.origin}/join/${state.game.inviteCode}` : null;

  return (
    <div className="page page-game">
      <header className="game-header">
        <div className="game-header-main">
          <Link to="/" className="back-link">
            <Icon name="chevronLeft" size={16} /> {t.common.games}
          </Link>
          <h1 className="display game-title" dir="auto">
            {state.game.name}
          </h1>
          <div className="game-header-meta">
            <AvatarStack players={lookup.active} max={8} size={30} />
            <span className="muted small">{t.common.players(lookup.active.length)}</span>
          </div>
        </div>
        {inviteUrl && (
          <Button icon="link" className="invite-btn" onClick={() => copy(inviteUrl, t.game.inviteCopied)}>
            <span className="invite-btn-label">{t.game.invite}</span>
          </Button>
        )}
      </header>

      {/* Top tabs on wide screens; a fixed bottom bar on phones (same element, restyled). */}
      <nav className="tabs" aria-label={state.game.name}>
        {TABS.map((item) => (
          <Link
            key={item.tab}
            to={`/g/${gameId}${item.path}`}
            className="tab"
            aria-current={item.tab === tab ? 'page' : undefined}
          >
            <span className="tab-icon">
              <Icon name={item.icon} size={20} />
              {item.tab === 'players' && lookup.isAdmin && lookup.pending.length > 0 && <span className="badge tab-badge">{lookup.pending.length}</span>}
            </span>
            <span className="tab-label">{t.game.tabs[item.tab]}</span>
          </Link>
        ))}
      </nav>

      <div className="tab-content">{children}</div>
    </div>
  );
}
