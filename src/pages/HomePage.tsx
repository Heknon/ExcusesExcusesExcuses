import { useState, type FormEvent } from 'react';
import type { GameSummary } from '../../shared/types.ts';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Link, navigate } from '../router.tsx';
import { useMe, useSession } from '../session.tsx';
import { AvatarStack, Button, Icon, Modal, Pill, useToast } from '../ui.tsx';

export function HomePage() {
  const me = useMe();
  const { refresh } = useSession();
  const { t, errorText } = useI18n();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const active = me.games.filter((g) => g.status === 'active');
  const pending = me.games.filter((g) => g.status === 'pending');

  const cancel = async (g: GameSummary) => {
    await api.cancelRequest(g.id).catch((e) => toast(errorText(e), 'error'));
    refresh();
  };

  return (
    <div className="page page-narrow">
      <header className="home-header">
        <div>
          <p className="eyebrow" dir="auto">
            {t.home.hi(me.user.name)}
          </p>
          <h1 className="display">{t.common.yourGames}</h1>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
          {t.home.newGame}
        </Button>
      </header>

      {active.length === 0 && pending.length === 0 ? (
        <div className="start-tiles">
          <button className="start-tile" onClick={() => setCreating(true)}>
            <span className="start-tile-icon">
              <Icon name="crown" size={22} />
            </span>
            <span className="start-tile-title">{t.home.startTitle}</span>
            <span className="start-tile-text">{t.home.startText}</span>
          </button>
          <div className="start-tile">
            <span className="start-tile-icon">
              <Icon name="users" size={22} />
            </span>
            <span className="start-tile-title">{t.home.joinTitle}</span>
            <span className="start-tile-text">{t.home.joinText}</span>
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
              <h2 className="section-title">{t.home.waitingTitle}</h2>
              <ul className="list">
                {pending.map((g) => (
                  <li key={g.id} className="list-row">
                    <div className="list-row-main">
                      <span className="list-row-title" dir="auto">
                        {g.name}
                      </span>
                      <span className="muted small">{t.home.waitingText}</span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => cancel(g)}>
                      {t.home.cancelRequest}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="section join-inline">
            <h2 className="section-title">{t.home.joinAnother}</h2>
            <JoinForm />
          </section>
        </>
      )}

      {creating && <CreateGameModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function GameCard({ game: g }: { game: GameSummary }) {
  const { t, fmt } = useI18n();
  return (
    <Link to={`/g/${g.id}`} className={`game-card ${g.todo ? 'has-todo' : ''}`}>
      <div className="game-card-top">
        <span className="game-card-name" dir="auto">
          {g.name}
        </span>
        {g.role === 'admin' && <Pill icon="crown">{t.common.admin}</Pill>}
      </div>
      <div className="game-card-meta">
        <AvatarStack players={g.players} max={6} />
        <span className="muted small">{t.common.players(g.players.length)}</span>
      </div>
      <div className="game-card-round">
        {g.round ? (
          <>
            <Pill tone={g.round.status}>{t.phase[g.round.status]}</Pill>
            <span className="muted small">{fmt.weekRange(g.round.startDate)}</span>
          </>
        ) : (
          <span className="muted small">{t.home.noRounds}</span>
        )}
      </div>
      {g.todo && (
        <div className="game-card-todo">
          <span className="todo-dot" />
          {t.home.todo[g.todo]}
          {g.todo === 'requests' && ` (${g.pendingRequests})`}
          <Icon name="chevronRight" size={16} />
        </div>
      )}
    </Link>
  );
}

function JoinForm() {
  const { t } = useI18n();
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
        dir="ltr"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder={t.home.codePlaceholder}
        aria-label={t.home.codeLabel}
        maxLength={12}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
      />
      <Button type="submit" disabled={!code.trim()}>
        {t.home.join}
      </Button>
    </form>
  );
}

function CreateGameModal({ onClose }: { onClose: () => void }) {
  const { refresh } = useSession();
  const { t, errorText } = useI18n();
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
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t.home.createTitle}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => submit()}>
            {t.home.createCta}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <label className="field">
          <span className="field-label">{t.home.gameName}</span>
          <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.home.gameNamePlaceholder} autoFocus maxLength={40} />
          <span className="field-hint">{t.home.gameNameHint}</span>
        </label>
        {error && <p className="form-error">{error}</p>}
      </form>
    </Modal>
  );
}
