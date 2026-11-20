import { useState, type FormEvent } from 'react';
import type { Player } from '../../shared/types.ts';
import { api } from '../api.ts';
import { useI18n } from '../i18n.tsx';
import { Link } from '../router.tsx';
import { useGame } from '../session.tsx';
import { Avatar, Button, Icon, Modal, Pill, useCopy } from '../ui.tsx';

export function PlayersPage() {
  const { lookup, state } = useGame();
  const { t } = useI18n();
  const removed = state.players.filter((p) => p.status === 'removed');

  return (
    <div className="players">
      {lookup.isAdmin && <InvitePanel />}
      {lookup.isAdmin && lookup.pending.length > 0 && <JoinRequests />}

      <section className="section">
        <div className="section-head">
          <h3 className="section-title">{t.players.atTable(lookup.active.length)}</h3>
          {lookup.isAdmin && <AddGuest />}
        </div>
        <ul className="roster">
          {lookup.active.map((p) => (
            <RosterRow key={p.id} player={p} />
          ))}
        </ul>
      </section>

      {removed.length > 0 && (
        <details className="section removed">
          <summary className="section-title">{t.players.former(removed.length)}</summary>
          <ul className="roster">
            {removed.map((p) => (
              <RosterRow key={p.id} player={p} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function InvitePanel() {
  const { state } = useGame();
  const { t } = useI18n();
  const copy = useCopy();
  const code = state.game.inviteCode!;
  const url = `${location.origin}/join/${code}`;
  return (
    <section className="invite">
      <div className="invite-text">
        <h3>{t.players.inviteTitle}</h3>
        <p className="muted">{t.players.inviteText}</p>
      </div>
      <div className="invite-actions">
        <button className="invite-code" dir="ltr" onClick={() => copy(code, t.players.codeCopied)} title={t.players.copyCode}>
          {code}
        </button>
        <Button variant="primary" icon="link" onClick={() => copy(url, t.game.inviteCopied)}>
          {t.players.copyLink}
        </Button>
      </div>
    </section>
  );
}

function JoinRequests() {
  const { lookup, gameId, run } = useGame();
  const { t } = useI18n();
  const guests = lookup.active.filter((p) => !p.hasAccount);
  const [linking, setLinking] = useState<Player | null>(null);

  return (
    <section className="section requests">
      <h3 className="section-title">
        {t.players.requests} <span className="badge">{lookup.pending.length}</span>
      </h3>
      <ul className="roster">
        {lookup.pending.map((p) => (
          <li key={p.id} className="roster-row is-request">
            <Avatar id={p.id} name={p.name} size={40} />
            <span className="roster-main">
              <span className="roster-name" dir="auto">
                {p.name}
              </span>
              <span className="muted small" dir="ltr">
                {p.email}
              </span>
            </span>
            <span className="roster-actions">
              <Button size="sm" variant="ghost" onClick={() => run(() => api.playerAction(gameId, p.id, { action: 'reject' }), t.players.declined)}>
                {t.players.decline}
              </Button>
              {guests.length > 0 && (
                <Button size="sm" onClick={() => setLinking(p)}>
                  {t.players.isGuest}
                </Button>
              )}
              <Button size="sm" variant="primary" icon="check" onClick={() => run(() => api.playerAction(gameId, p.id, { action: 'approve' }), t.players.joined(p.name))}>
                {t.players.letIn}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {linking && <LinkGuestModal request={linking} guests={guests} onClose={() => setLinking(null)} />}
    </section>
  );
}

function LinkGuestModal({ request, guests, onClose }: { request: Player; guests: Player[]; onClose: () => void }) {
  const { gameId, run } = useGame();
  const { t } = useI18n();
  const [guestId, setGuestId] = useState<number | null>(null);
  const approve = async () => {
    if (guestId == null) return;
    const ok = await run(() => api.playerAction(gameId, request.id, { action: 'approve', guestId }), t.players.linked(request.name));
    if (ok) onClose();
  };
  return (
    <Modal
      title={t.players.linkTitle(request.name)}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" disabled={guestId == null} onClick={approve}>
            {t.players.linkCta}
          </Button>
        </>
      }
    >
      <p className="muted">{t.players.linkBody}</p>
      <div className="choice-list">
        {guests.map((g) => (
          <label key={g.id} className={`choice ${guestId === g.id ? 'is-on' : ''}`}>
            <input type="radio" name="guest" checked={guestId === g.id} onChange={() => setGuestId(g.id)} />
            <Avatar id={g.id} name={g.name} size={32} />
            <span dir="auto">{g.name}</span>
          </label>
        ))}
      </div>
    </Modal>
  );
}

function AddGuest() {
  const { gameId, run } = useGame();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return;
    const ok = await run(() => api.addGuest(gameId, name.trim()), t.players.guestAdded(name.trim()));
    if (ok) {
      setName('');
      setOpen(false);
    }
  };
  return (
    <>
      <Button size="sm" icon="plus" onClick={() => setOpen(true)}>
        {t.players.addGuest}
      </Button>
      {open && (
        <Modal
          title={t.players.addGuestTitle}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t.common.cancel}
              </Button>
              <Button variant="primary" disabled={!name.trim()} onClick={() => submit()}>
                {t.players.addGuest}
              </Button>
            </>
          }
        >
          <form onSubmit={submit}>
            <label className="field">
              <span className="field-label">{t.players.guestName}</span>
              <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} />
              <span className="field-hint">{t.players.guestHint}</span>
            </label>
          </form>
        </Modal>
      )}
    </>
  );
}

function RosterRow({ player: p }: { player: Player }) {
  const { lookup, gameId, run } = useGame();
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const act = (input: Parameters<typeof api.playerAction>[2], msg: string) => {
    setMenu(false);
    run(() => api.playerAction(gameId, p.id, input), msg);
  };

  return (
    <li className={`roster-row ${p.status === 'removed' ? 'is-removed' : ''}`}>
      <Link to={`/g/${gameId}/players/${p.id}`} className="roster-link">
        <Avatar id={p.id} name={p.name} size={40} />
        <span className="roster-main">
          <span className="roster-name" dir="auto">
            {p.name}
            {p.isMe && <span className="you-tag">{t.common.you}</span>}
          </span>
          <span className="roster-tags">
            {p.role === 'admin' && <Pill icon="crown">{t.common.admin}</Pill>}
            {!p.hasAccount && <Pill>{t.common.guest}</Pill>}
          </span>
        </span>
      </Link>
      {lookup.isAdmin && !p.isMe && (
        <span className="roster-menu">
          <button className="icon-btn" aria-label={t.players.manage(p.name)} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon name="chevronDown" />
          </button>
          {menu && (
            <span className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {p.status === 'removed' ? (
                <button role="menuitem" onClick={() => act({ action: 'restore' }, t.players.back(p.name))}>
                  {t.players.bringBack}
                </button>
              ) : (
                <>
                  {p.hasAccount && p.role === 'player' && (
                    <button role="menuitem" onClick={() => act({ action: 'update', role: 'admin' }, t.players.madeAdmin(p.name))}>
                      {t.players.makeAdmin}
                    </button>
                  )}
                  {p.role === 'admin' && (
                    <button role="menuitem" onClick={() => act({ action: 'update', role: 'player' }, t.players.removedAdmin(p.name))}>
                      {t.players.removeAdmin}
                    </button>
                  )}
                  <button
                    role="menuitem"
                    onClick={() => {
                      const name = prompt(t.players.renamePrompt, p.name);
                      if (name?.trim()) act({ action: 'update', name: name.trim() }, t.players.renamed);
                      else setMenu(false);
                    }}
                  >
                    {t.players.rename}
                  </button>
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => confirm(t.players.removeConfirm(p.name)) && act({ action: 'remove' }, t.players.removed(p.name))}
                  >
                    {t.players.remove}
                  </button>
                </>
              )}
            </span>
          )}
        </span>
      )}
    </li>
  );
}
