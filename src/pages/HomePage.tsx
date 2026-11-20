import { useState, type FormEvent } from 'react';
import type { GameSummary } from '../../shared/types.ts';
import { api } from '../api.ts';
import { PHASE_LABEL, weekRange } from '../format.ts';
import { Link, navigate } from '../router.tsx';
import { useMe, useSession } from '../session.tsx';
import { AvatarStack, Button, Icon, Modal, Pill, useToast } from '../ui.tsx';

const TODO_LABEL: Record<NonNullable<GameSummary['todo']>, string> = {
  submit: 'Lock in your move',
  report: 'Report how it went',
  requests: 'Join requests waiting',
};

export function HomePage() {
  const me = useMe();
  const { refresh } = useSession();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const active = me.games.filter((g) => g.status === 'active');
  const pending = me.games.filter((g) => g.status === 'pending');

  const cancel = async (g: GameSummary) => {
    await api.cancelRequest(g.id).catch((e) => toast(e.message, 'error'));
    refresh();
  };

  return (
    <div className="page page-narrow">
      <header className="home-header">
        <div>
          <p className="eyebrow">Hi, {me.user.name}</p>
          <h1 className="display">Your games</h1>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          New game
        </Button>
      </header>

      {active.length === 0 && pending.length === 0 ? (
        <div className="start-tiles">
          <button className="start-tile" onClick={() => setCreating(true)}>
            <span className="start-tile-icon">
              <Icon name="crown" size={22} />
            </span>
            <span className="start-tile-title">Start a game</span>
            <span className="start-tile-text">You’ll be the admin. Invite your group with a link and approve who gets in.</span>
          </button>
          <div className="start-tile">
            <span className="start-tile-icon">
              <Icon name="users" size={22} />
            </span>
            <span className="start-tile-title">Join a game</span>
            <span className="start-tile-text">Got an invite code from a friend? Enter it to request a seat.</span>
            <JoinForm />
          </div>
        </div>
      ) : (
        <>
          <ul className="game-cards">
            {active.map((g) => (
              <li key={g.id}>
                <GameCard game={g} />
              </li>
            ))}
          </ul>

          {pending.length > 0 && (
            <section className="section">
              <h2 className="section-title">Waiting for approval</h2>
              <ul className="list">
                {pending.map((g) => (
                  <li key={g.id} className="list-row">
                    <div className="list-row-main">
                      <span className="list-row-title" dir="auto">
                        {g.name}
                      </span>
                      <span className="muted small">An admin needs to let you in.</span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => cancel(g)}>
                      Cancel request
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="section join-inline">
            <h2 className="section-title">Join another game</h2>
            <JoinForm />
          </section>
        </>
      )}

      {creating && <CreateGameModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function GameCard({ game: g }: { game: GameSummary }) {
  return (
    <Link to={`/g/${g.id}`} className={`game-card ${g.todo ? 'has-todo' : ''}`}>
      <div className="game-card-top">
        <span className="game-card-name" dir="auto">
          {g.name}
        </span>
        {g.role === 'admin' && <Pill icon="crown">Admin</Pill>}
      </div>
      <div className="game-card-meta">
        <AvatarStack players={g.players} max={6} />
        <span className="muted small">{g.players.length} players</span>
      </div>
      <div className="game-card-round">
        {g.round ? (
          <>
            <Pill tone={g.round.status}>{PHASE_LABEL[g.round.status]}</Pill>
            <span className="muted small">{weekRange(g.round.startDate)}</span>
          </>
        ) : (
          <span className="muted small">No rounds yet</span>
        )}
      </div>
      {g.todo && (
        <div className="game-card-todo">
          <span className="todo-dot" />
          {TODO_LABEL[g.todo]}
          {g.todo === 'requests' && ` (${g.pendingRequests})`}
          <Icon name="chevronRight" size={16} />
        </div>
      )}
    </Link>
  );
}

function JoinForm() {
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c) navigate(`/join/${c}`);
  };
  return (
    <form className="join-form" onSubmit={submit}>
      <input
        className="input input-code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="INVITE CODE"
        aria-label="Invite code"
        maxLength={12}
        autoCapitalize="characters"
        spellCheck={false}
      />
      <Button type="submit" disabled={!code.trim()}>
        Join
      </Button>
    </form>
  );
}

function CreateGameModal({ onClose }: { onClose: () => void }) {
  const { refresh } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { id } = await api.createGame(name.trim());
      await refresh();
      navigate(`/g/${id}/players`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="New game"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => submit()}>
            Create game
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">Game name</span>
          <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunday crew" autoFocus maxLength={40} />
          <span className="field-hint">Next you’ll get an invite link to share with the group.</span>
        </label>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}
