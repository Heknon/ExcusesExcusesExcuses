import { useState, type FormEvent } from 'react';
import type { Player } from '../../shared/types.ts';
import { api } from '../api.ts';
import { Link } from '../router.tsx';
import { useGame } from '../session.tsx';
import { Avatar, Button, Icon, Modal, Pill, useCopy } from '../ui.tsx';

export function PlayersPage() {
  const { lookup, state } = useGame();
  const removed = state.players.filter((p) => p.status === 'removed');

  return (
    <div className="players">
      {lookup.isAdmin && <InvitePanel />}
      {lookup.isAdmin && lookup.pending.length > 0 && <JoinRequests />}

      <section className="section">
        <div className="section-head">
          <h3 className="section-title">At the table · {lookup.active.length}</h3>
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
          <summary className="section-title">Former players · {removed.length}</summary>
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
  const copy = useCopy();
  const code = state.game.inviteCode!;
  const url = `${location.origin}/join/${code}`;
  return (
    <section className="invite">
      <div className="invite-text">
        <h3>Invite your group</h3>
        <p className="muted">Anyone with the link can ask to join. You approve each request.</p>
      </div>
      <div className="invite-actions">
        <button className="invite-code" onClick={() => copy(code, 'Code copied')} title="Copy code">
          {code}
        </button>
        <Button variant="primary" icon="link" onClick={() => copy(url, 'Invite link copied')}>
          Copy link
        </Button>
      </div>
    </section>
  );
}

function JoinRequests() {
  const { lookup, gameId, run } = useGame();
  const guests = lookup.active.filter((p) => !p.hasAccount);
  const [linking, setLinking] = useState<Player | null>(null);

  return (
    <section className="section requests">
      <h3 className="section-title">
        Join requests <span className="badge">{lookup.pending.length}</span>
      </h3>
      <ul className="roster">
        {lookup.pending.map((p) => (
          <li key={p.id} className="roster-row is-request">
            <Avatar id={p.id} name={p.name} size={40} />
            <span className="roster-main">
              <span className="roster-name" dir="auto">
                {p.name}
              </span>
              <span className="muted small">{p.email}</span>
            </span>
            <span className="roster-actions">
              <Button size="sm" variant="ghost" onClick={() => run(() => api.playerAction(gameId, p.id, { action: 'reject' }), 'Request declined')}>
                Decline
              </Button>
              {guests.length > 0 && (
                <Button size="sm" onClick={() => setLinking(p)}>
                  Is a guest…
                </Button>
              )}
              <Button size="sm" variant="primary" icon="check" onClick={() => run(() => api.playerAction(gameId, p.id, { action: 'approve' }), `${p.name} joined`)}>
                Let in
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
  const [guestId, setGuestId] = useState<number | null>(null);
  const approve = async () => {
    if (guestId == null) return;
    const ok = await run(() => api.playerAction(gameId, request.id, { action: 'approve', guestId }), `${request.name} took over their seat`);
    if (ok) onClose();
  };
  return (
    <Modal
      title={`Is ${request.name} one of your guests?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={guestId == null} onClick={approve}>
            Let in as this guest
          </Button>
        </>
      }
    >
      <p className="muted">Their account takes over the guest’s seat, including every past goal, pick and result.</p>
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
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!name.trim()) return;
    const ok = await run(() => api.addGuest(gameId, name.trim()), `${name.trim()} added as a guest`);
    if (ok) {
      setName('');
      setOpen(false);
    }
  };
  return (
    <>
      <Button size="sm" icon="plus" onClick={() => setOpen(true)}>
        Add guest
      </Button>
      {open && (
        <Modal
          title="Add a guest player"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!name.trim()} onClick={() => submit()}>
                Add guest
              </Button>
            </>
          }
        >
          <form onSubmit={submit}>
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={40} />
              <span className="field-hint">
                For someone who hasn’t signed up yet. You can enter their moves for them, and when they join you can hand them the seat with all its history.
              </span>
            </label>
          </form>
        </Modal>
      )}
    </>
  );
}

function RosterRow({ player: p }: { player: Player }) {
  const { lookup, gameId, run } = useGame();
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
            {p.isMe && <span className="you-tag">You</span>}
          </span>
          <span className="roster-tags">
            {p.role === 'admin' && <Pill icon="crown">Admin</Pill>}
            {!p.hasAccount && <Pill>Guest</Pill>}
          </span>
        </span>
      </Link>
      {lookup.isAdmin && !p.isMe && (
        <span className="roster-menu">
          <button className="icon-btn" aria-label={`Manage ${p.name}`} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon name="chevronDown" />
          </button>
          {menu && (
            <span className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {p.status === 'removed' ? (
                <button role="menuitem" onClick={() => act({ action: 'restore' }, `${p.name} is back`)}>
                  Bring back
                </button>
              ) : (
                <>
                  {p.hasAccount && p.role === 'player' && (
                    <button role="menuitem" onClick={() => act({ action: 'update', role: 'admin' }, `${p.name} is now an admin`)}>
                      Make admin
                    </button>
                  )}
                  {p.role === 'admin' && (
                    <button role="menuitem" onClick={() => act({ action: 'update', role: 'player' }, `${p.name} is no longer an admin`)}>
                      Remove admin
                    </button>
                  )}
                  <button
                    role="menuitem"
                    onClick={() => {
                      const name = prompt('Rename player', p.name);
                      if (name?.trim()) act({ action: 'update', name: name.trim() }, 'Renamed');
                      else setMenu(false);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    role="menuitem"
                    className="danger"
                    onClick={() => confirm(`Remove ${p.name} from the game? Their history stays.`) && act({ action: 'remove' }, `${p.name} removed`)}
                  >
                    Remove from game
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
