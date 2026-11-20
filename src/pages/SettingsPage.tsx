import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { parseRound } from '../../shared/whatsapp.ts';
import { api, type ImportRow } from '../api.ts';
import { addDays, weekStart } from '../format.ts';
import { useI18n } from '../i18n.tsx';
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
  const { t } = useI18n();
  const [name, setName] = useState(state.game.name);
  return (
    <SettingsCard title={t.settings.gameName}>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) run(() => api.updateGame(gameId, { name: name.trim() }), t.settings.renamed);
        }}
      >
        <input className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label={t.settings.gameName} />
        <Button type="submit" disabled={!name.trim() || name.trim() === state.game.name}>
          {t.common.save}
        </Button>
      </form>
    </SettingsCard>
  );
}

function InviteCode() {
  const { state, gameId, run } = useGame();
  const { t } = useI18n();
  return (
    <SettingsCard title={t.settings.inviteCode} description={t.settings.inviteCodeText}>
      <div className="inline-form">
        <code className="invite-code invite-code-static" dir="ltr">
          {state.game.inviteCode}
        </code>
        <Button onClick={() => run(() => api.updateGame(gameId, { regenerateCode: true }), t.settings.codeReset)}>{t.settings.resetCode}</Button>
      </div>
    </SettingsCard>
  );
}

function ImportRound() {
  const { lookup, gameId, run } = useGame();
  const { t } = useI18n();
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
    const round = await run(() => api.importRound(gameId, { startDate, title: '', rows: included }), t.settings.imported);
    setBusy(false);
    if (round) navigate(`/g/${gameId}`);
  };

  return (
    <SettingsCard
      id="import"
      title={t.settings.importTitle}
      description={t.settings.importText}
    >
      {openRound ? (
        <p className="muted">{t.settings.importBlocked}</p>
      ) : (
        <>
          <AutoTextarea className="paste" value={text} onChange={(e) => setText(e.target.value)} placeholder={'*ביצועים*\n* מייקל - מכין פסטה\n…'} aria-label={t.settings.importTitle} />
          <div className="form-actions">
            <Button disabled={!text.trim()} onClick={parse}>
              {t.settings.review}
            </Button>
          </div>
          {rows && rows.length === 0 && <p className="form-error">{t.settings.noLines}</p>}
          {rows && rows.length > 0 && (
            <Modal
              title={t.settings.reviewTitle}
              onClose={() => setRows(null)}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setRows(null)}>
                    {t.common.cancel}
                  </Button>
                  <Button variant="primary" loading={busy} disabled={!included.length || taken.has(startDate)} onClick={save}>
                    {t.settings.importCta(included.length)}
                  </Button>
                </>
              }
            >
              <label className="field field-inline">
                <span className="field-label">{t.round.weekOf}</span>
                <input type="date" className="input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              {taken.has(startDate) && <p className="form-error">{t.settings.roundExists}</p>}
              <ul className="import-rows">
                {rows.map((r, i) => (
                  <li key={i} className={`import-row ${r.include ? '' : 'is-off'}`}>
                    <label className="import-row-head">
                      <input type="checkbox" checked={r.include} onChange={(e) => update(i, { include: e.target.checked })} />
                      <input className="input input-name" dir="auto" value={r.name} onChange={(e) => update(i, { name: e.target.value })} aria-label={t.players.guestName} />
                      {!known.includes(r.name) && <span className="muted small">{t.settings.newGuest}</span>}
                    </label>
                    <AutoTextarea value={r.goal} onChange={(e) => update(i, { goal: e.target.value })} aria-label={t.round.goalLabel} />
                    <div className="import-picks">
                      {(['excuse', 'bet'] as const).map((k) => (
                        <label key={k} className="field">
                          <span className="field-label">{k === 'excuse' ? t.round.excusesFrom : t.round.delivering}</span>
                          <select className="input" value={r[`${k}Target`]} onChange={(e) => update(i, { [`${k}Target`]: e.target.value })}>
                            <option value="">{t.common.noPick}</option>
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
                  <summary>{t.settings.skipped(skipped.length)}</summary>
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
  const { t } = useI18n();
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
    <SettingsCard title={t.settings.dangerTitle} description={t.settings.dangerText}>
      <div className="inline-form">
        <Button onClick={() => setConfirm('leave')}>{t.settings.leave}</Button>
        {lookup.isAdmin && (
          <Button variant="danger" onClick={() => setConfirm('delete')}>
            {t.settings.delete}
          </Button>
        )}
      </div>
      {confirm && (
        <Modal
          title={confirm === 'leave' ? t.settings.leaveTitle : t.settings.deleteTitle(state.game.name)}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {t.common.cancel}
              </Button>
              <Button variant="danger" onClick={confirm === 'leave' ? leave : remove}>
                {confirm === 'leave' ? t.settings.leaveCta : t.settings.deleteCta}
              </Button>
            </>
          }
        >
          <p>
            {confirm === 'leave' ? t.settings.leaveBody : t.settings.deleteBody}
          </p>
        </Modal>
      )}
    </SettingsCard>
  );
}
