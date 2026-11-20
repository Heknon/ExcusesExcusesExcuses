import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { parseRound } from '../../shared/whatsapp.ts';
import { api, type ImportRow } from '../api.ts';
import { addDays, weekStart } from '../format.ts';
import { navigate } from '../router.tsx';
import { useGame, useSession } from '../session.tsx';
import { AutoTextarea, Button, Modal } from '../ui.tsx';

export function SettingsPage() {
  const { lookup } = useGame();
  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }, []);

  return (
    <div className="settings">
      {lookup.isAdmin && <GameName />}
      {lookup.isAdmin && <InviteCode />}
      {lookup.isAdmin && <ImportRound />}
      <DangerZone />
    </div>
  );
}

function SettingsCard({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return (
    <section className="settings-card" id={id}>
      <div className="settings-card-text">
        <h3>{title}</h3>
        {description && <p className="muted">{description}</p>}
      </div>
      <div className="settings-card-body">{children}</div>
    </section>
  );
}

function GameName() {
  const { state, gameId, run } = useGame();
  const [name, setName] = useState(state.game.name);
  return (
    <SettingsCard title="Game name">
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) run(() => api.updateGame(gameId, { name: name.trim() }), 'Renamed');
        }}
      >
        <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Game name" />
        <Button type="submit" disabled={!name.trim() || name.trim() === state.game.name}>
          Save
        </Button>
      </form>
    </SettingsCard>
  );
}

function InviteCode() {
  const { state, gameId, run } = useGame();
  return (
    <SettingsCard title="Invite code" description="Resetting makes the old code and link stop working. Pending requests stay.">
      <div className="inline-form">
        <code className="invite-code invite-code-static">{state.game.inviteCode}</code>
        <Button onClick={() => run(() => api.updateGame(gameId, { regenerateCode: true }), 'New invite code ready')}>Reset code</Button>
      </div>
    </SettingsCard>
  );
}

function ImportRound() {
  const { lookup, gameId, run } = useGame();
  const known = useMemo(() => lookup.active.map((p) => p.name), [lookup.active]);
  const [text, setText] = useState('');
  const [rows, setRows] = useState<(ImportRow & { include: boolean })[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const taken = new Set(lookup.rounds.map((r) => r.startDate));
  const [startDate, setStartDate] = useState(() => {
    let d = weekStart();
    while (taken.has(d)) d = addDays(d, -7);
    return d;
  });
  const [busy, setBusy] = useState(false);
  const openRound = lookup.rounds.find((r) => r.status !== 'final');
  const included = (rows ?? []).filter((r) => r.include && r.name.trim());
  const names = [...new Set([...known, ...included.map((r) => r.name)])];

  const parse = () => {
    const r = parseRound(text, known);
    setSkipped(r.skipped);
    setRows(
      r.rows.map((x) => ({
        include: true,
        name: x.name,
        goal: x.goal,
        excuseTarget: x.excuse?.target ?? '',
        excuseReason: x.excuse?.reason ?? '',
        betTarget: x.bet?.target ?? '',
        betReason: x.bet?.reason ?? '',
      })),
    );
  };
  const update = (i: number, patch: Partial<ImportRow & { include: boolean }>) => setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    const round = await run(() => api.importRound(gameId, { startDate, title: '', rows: included }), 'Round imported');
    setBusy(false);
    if (round) navigate(`/g/${gameId}`);
  };

  return (
    <SettingsCard
      id="import"
      title="Import from WhatsApp"
      description="Paste a round posted in the group (ביצועים, תירוצים, הימורים). New names become guest players you can later hand to their accounts. The round starts in progress."
    >
      {openRound ? (
        <p className="muted">Score the current round before importing another.</p>
      ) : (
        <>
          <AutoTextarea className="paste" value={text} onChange={(e) => setText(e.target.value)} placeholder={'*ביצועים*\n* מייקל - מכין פסטה\n…'} aria-label="WhatsApp message" />
          <div className="form-actions">
            <Button disabled={!text.trim()} onClick={parse}>
              Review
            </Button>
          </div>
          {rows && rows.length === 0 && <p className="form-error">No lines recognized. Include the section headings.</p>}
          {rows && rows.length > 0 && (
            <Modal
              title="Review import"
              onClose={() => setRows(null)}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setRows(null)}>
                    Cancel
                  </Button>
                  <Button variant="primary" loading={busy} disabled={!included.length || taken.has(startDate)} onClick={save}>
                    Import {included.length} players
                  </Button>
                </>
              }
            >
              <label className="field field-inline">
                <span className="field-label">Week of</span>
                <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              {taken.has(startDate) && <p className="form-error">There’s already a round for that week.</p>}
              <ul className="import-rows">
                {rows.map((r, i) => (
                  <li key={i} className={`import-row ${r.include ? '' : 'is-off'}`}>
                    <label className="import-row-head">
                      <input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} />
                      <input className="input input-name" dir="auto" value={r.name} onChange={(e) => update(i, { name: e.target.value })} aria-label="Name" />
                      {!known.includes(r.name) && <span className="muted small">new guest</span>}
                    </label>
                    <AutoTextarea value={r.goal} onChange={(e) => update(i, { goal: e.target.value })} aria-label="Goal" />
                    <div className="import-picks">
                      {(['excuse', 'bet'] as const).map((k) => (
                        <label key={k} className="field">
                          <span className="field-label">{k === 'excuse' ? 'Excuses from' : 'Delivering'}</span>
                          <select className="input" value={r[`${k}Target`]} onChange={(e) => update(i, { [`${k}Target`]: e.target.value })}>
                            <option value="">No pick</option>
                            {[...new Set([...names, r[`${k}Target`]])]
                              .filter((n) => n && n !== r.name)
                              .map((n) => (
                                <option key={n} value={n}>
                                  {n}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
              {skipped.length > 0 && (
                <details className="muted small">
                  <summary>{skipped.length} line(s) skipped</summary>
                  <ul>
                    {skipped.map((s, i) => (
                      <li key={i} dir="auto">
                        {s}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Modal>
          )}
        </>
      )}
    </SettingsCard>
  );
}

function DangerZone() {
  const { lookup, state, gameId, run } = useGame();
  const { refresh } = useSession();
  const [confirm, setConfirm] = useState<null | 'leave' | 'delete'>(null);

  const leave = async () => {
    const ok = await run(() => api.leaveGame(gameId));
    if (ok !== undefined) {
      await refresh();
      navigate('/', { replace: true });
    }
  };
  const remove = async () => {
    const ok = await run(() => api.deleteGame(gameId));
    if (ok !== undefined) {
      await refresh();
      navigate('/', { replace: true });
    }
  };

  return (
    <SettingsCard title="Leave or delete" description="Leaving keeps your history in the game. Deleting removes the game for everyone.">
      <div className="inline-form">
        <Button onClick={() => setConfirm('leave')}>Leave game</Button>
        {lookup.isAdmin && (
          <Button variant="danger" onClick={() => setConfirm('delete')}>
            Delete game
          </Button>
        )}
      </div>
      {confirm && (
        <Modal
          title={confirm === 'leave' ? 'Leave this game?' : `Delete “${state.game.name}”?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirm === 'leave' ? leave : remove}>
                {confirm === 'leave' ? 'Leave' : 'Delete forever'}
              </Button>
            </>
          }
        >
          <p>
            {confirm === 'leave'
              ? 'You’ll need a new invite and approval to come back.'
              : 'Every round, goal, pick and note in this game will be permanently deleted for all players.'}
          </p>
        </Modal>
      )}
    </SettingsCard>
  );
}
