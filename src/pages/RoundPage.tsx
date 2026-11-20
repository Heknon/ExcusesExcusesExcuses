import { useEffect, useState } from 'react';
import { entryPoints, isResolved, outcomesByPlayer, POINTS } from '../../shared/scoring.ts';
import type { Entry, Outcome, Player, Round } from '../../shared/types.ts';
import { api } from '../api.ts';
import { addDays, daysLeft, weekStart } from '../format.ts';
import { useI18n } from '../i18n.tsx';
import { ProofStrip, ProofUploader } from '../proofs.tsx';
import { Link, navigate } from '../router.tsx';
import { useGame } from '../session.tsx';
import {
  AutoTextarea,
  Avatar,
  Button,
  EmptyState,
  Icon,
  Modal,
  OUTCOME_ICON,
  OutcomePill,
  PhaseSteps,
  Pill,
  PlayerPicker,
} from '../ui.tsx';

export function RoundPage({ roundId }: { roundId?: number }) {
  const { lookup, gameId } = useGame();
  const { t, fmt } = useI18n();
  const round = roundId ? lookup.round.get(roundId) : lookup.current;

  if (!round) {
    if (roundId) return <EmptyState icon="x" title={t.round.notFound} />;
    return lookup.isAdmin ? (
      <StartRoundCard first />
    ) : (
      <EmptyState icon="clock" title={t.round.noRoundsTitle}>
        {t.round.noRoundsBody}
      </EmptyState>
    );
  }

  const index = lookup.rounds.indexOf(round);
  const number = lookup.rounds.length - index;
  const newer = lookup.rounds[index - 1];
  const older = lookup.rounds[index + 1];
  const entries = (lookup.entriesByRound.get(round.id) ?? [])
    .slice()
    .sort((a, b) => seat(lookup.player.get(a.playerId)) - seat(lookup.player.get(b.playerId)));
  const mine = entries.find((e) => e.playerId === lookup.me.id);
  const isCurrent = round === lookup.current;
  const left = daysLeft(round.startDate);

  return (
    <div className="round">
      {isCurrent && round.status === 'final' && lookup.isAdmin && <StartRoundCard after={round} />}

      <header className="round-header">
        <div className="round-heading">
          <div className="round-nav">
            {older ? (
              <Link to={`/g/${gameId}/rounds/${older.id}`} className="icon-btn" aria-label={t.round.prev}>
                <Icon name="chevronLeft" />
              </Link>
            ) : (
              <span className="icon-btn is-disabled" />
            )}
            <span className="eyebrow">{t.round.number(number)}</span>
            {newer ? (
              <Link to={newer === lookup.current ? `/g/${gameId}` : `/g/${gameId}/rounds/${newer.id}`} className="icon-btn" aria-label={t.round.next}>
                <Icon name="chevronRight" />
              </Link>
            ) : (
              <span className="icon-btn is-disabled" />
            )}
          </div>
          <h2 className="display round-title">{fmt.weekRange(round.startDate)}</h2>
          {round.title && (
            <p className="round-subtitle" dir="auto">
              {round.title}
            </p>
          )}
          {round.status === 'live' && (
            <Pill tone="live" icon="clock">
              {left > 0 ? t.round.daysLeft(left) : t.round.weekOver}
            </Pill>
          )}
        </div>
        <PhaseSteps status={round.status} />
      </header>

      {lookup.isAdmin && (round.status !== 'final' || isCurrent) && <AdminBar round={round} entries={entries} />}

      {mine && lookup.me.status === 'active' && <YourMove round={round} entry={mine} entries={entries} />}

      <section className="section">
        <div className="section-head">
          <h3 className="section-title">{t.round.table}</h3>
          <TableSummary round={round} entries={entries} />
        </div>
        {entries.length === 0 ? (
          <EmptyState title={t.round.nobody} />
        ) : (
          <ScoreTable round={round} entries={entries} />
        )}
      </section>

      <RoundNotes round={round} />
    </div>
  );
}

/** You first, then everyone in the order they joined. */
const seat = (p: Player | undefined) => (p?.isMe ? -1 : p?.id ?? 0);

/* ---------- admin ---------- */

function StartRoundCard({ first, after }: { first?: boolean; after?: Round }) {
  const { gameId, run, lookup } = useGame();
  const { t } = useI18n();
  const taken = new Set(lookup.rounds.map((r) => r.startDate));
  let suggested = after ? addDays(after.startDate, 7) : weekStart();
  if (after && suggested < weekStart()) suggested = weekStart();
  while (taken.has(suggested)) suggested = addDays(suggested, 7);
  const [date, setDate] = useState(suggested);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    const r = await run(() => api.createRound(gameId, date), t.round.opened);
    setBusy(false);
    if (r) navigate(`/g/${gameId}`, { keepScroll: true });
  };

  return (
    <div className="start-round">
      <div>
        <h2 className="start-round-title">{first ? t.round.startFirst : t.round.startNext}</h2>
        <p className="muted">{lookup.active.length < 2 ? t.round.needPlayers : t.round.dealtIn(lookup.active.length)}</p>
      </div>
      <div className="start-round-actions">
        <label className="field field-inline">
          <span className="field-label">{t.round.weekOf}</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <Button variant="primary" icon="flag" loading={busy} onClick={start}>
          {t.round.open}
        </Button>
      </div>
      {first && (
        <p className="muted small">
          {t.round.importInstead} <Link to={`/g/${gameId}/settings#import`}>{t.round.importLink}</Link>
        </p>
      )}
    </div>
  );
}

function AdminBar({ round, entries }: { round: Round; entries: Entry[] }) {
  const { gameId, run, lookup } = useGame();
  const { t, fmt } = useI18n();
  const [confirm, setConfirm] = useState<null | 'live' | 'final' | 'delete'>(null);
  const locked = entries.filter((e) => e.submitted).length;
  const reported = entries.filter((e) => isResolved(e.outcome)).length;
  const missing = (pred: (e: Entry) => boolean) =>
    entries
      .filter((e) => !pred(e))
      .map((e) => lookup.name(e.playerId))
      .join(', ');

  const setStatus = async (status: Round['status']) => {
    setConfirm(null);
    await run(
      () => api.updateRound(gameId, round.id, { status }),
      status === 'live' ? t.round.revealed : status === 'final' ? t.round.scored : t.round.reopened,
    );
  };

  const progress = round.status === 'planning' ? locked : reported;

  return (
    <div className="admin-bar">
      <span className="admin-tag">
        <Icon name="crown" size={14} /> {t.common.admin}
      </span>
      {round.status !== 'final' && (
        <div className="admin-progress">
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={entries.length} aria-valuenow={progress}>
            <span style={{ width: `${entries.length ? (progress / entries.length) * 100 : 0}%` }} />
          </div>
          <span className="small">
            {round.status === 'planning' ? t.round.lockedProgress(locked, entries.length) : t.round.reportedProgress(reported, entries.length)}
          </span>
        </div>
      )}
      <div className="admin-actions">
        {round.status === 'planning' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirm('delete')}>
              {t.round.deleteRound}
            </Button>
            <Button size="sm" variant="primary" icon="eye" onClick={() => (locked < entries.length ? setConfirm('live') : setStatus('live'))}>
              {t.round.startWeek}
            </Button>
          </>
        )}
        {round.status === 'live' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setStatus('planning')}>
              {t.round.backToPlanning}
            </Button>
            <Button size="sm" variant="primary" icon="trophy" onClick={() => (reported < entries.length ? setConfirm('final') : setStatus('final'))}>
              {t.round.score}
            </Button>
          </>
        )}
        {round.status === 'final' && (
          <Button size="sm" variant="ghost" onClick={() => setStatus('live')}>
            {t.round.reopen}
          </Button>
        )}
      </div>

      {confirm === 'live' && (
        <Modal
          title={t.round.confirmStartTitle}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {t.round.wait}
              </Button>
              <Button variant="primary" onClick={() => setStatus('live')}>
                {t.round.startAnyway}
              </Button>
            </>
          }
        >
          <p>{t.round.confirmStartBody(missing((e) => e.submitted))}</p>
        </Modal>
      )}
      {confirm === 'final' && (
        <Modal
          title={t.round.confirmScoreTitle}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {t.round.wait}
              </Button>
              <Button variant="primary" onClick={() => setStatus('final')}>
                {t.round.scoreAnyway}
              </Button>
            </>
          }
        >
          <p>{t.round.confirmScoreBody(missing((e) => isResolved(e.outcome)))}</p>
        </Modal>
      )}
      {confirm === 'delete' && (
        <Modal
          title={t.round.confirmDeleteTitle}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                {t.round.keep}
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  setConfirm(null);
                  await run(() => api.deleteRound(gameId, round.id), t.round.deleted);
                  navigate(`/g/${gameId}`, { replace: true });
                }}
              >
                {t.round.deleteRound}
              </Button>
            </>
          }
        >
          <p>{t.round.confirmDeleteBody(fmt.weekRange(round.startDate))}</p>
        </Modal>
      )}
    </div>
  );
}

/* ---------- your move ---------- */

function YourMove({ round, entry, entries }: { round: Round; entry: Entry; entries: Entry[] }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(!entry.submitted);
  useEffect(() => {
    if (!entry.submitted) setEditing(true);
  }, [entry.submitted]);

  if (round.status === 'planning') {
    return editing ? (
      <MoveForm round={round} entry={entry} onDone={() => setEditing(false)} />
    ) : (
      <section className="move move-locked">
        <header className="move-header">
          <div>
            <p className="eyebrow">{t.round.yourMove}</p>
            <h3 className="move-title">
              <Icon name="lock" size={18} /> {t.round.lockedIn}
            </h3>
          </div>
          <Button size="sm" icon="edit" onClick={() => setEditing(true)}>
            {t.round.change}
          </Button>
        </header>
        <MoveSummary entry={entry} />
        <p className="muted small">{t.round.changeHint}</p>
      </section>
    );
  }
  if (round.status === 'live') return <ReportResult round={round} entry={entry} />;
  return <FinalScore entry={entry} entries={entries} />;
}

function MoveForm({ round, entry, onDone }: { round: Round; entry: Entry; onDone: () => void }) {
  const { gameId, run, lookup } = useGame();
  const { t } = useI18n();
  const [goal, setGoal] = useState(entry.goal);
  const [excusePickId, setExcusePick] = useState(entry.excusePickId);
  const [excuseReason, setExcuseReason] = useState(entry.excuseReason);
  const [betPickId, setBetPick] = useState(entry.betPickId);
  const [betReason, setBetReason] = useState(entry.betReason);
  const [busy, setBusy] = useState(false);

  const roundPlayers = (lookup.entriesByRound.get(round.id) ?? [])
    .map((e) => lookup.player.get(e.playerId)!)
    .filter((p) => p && p.id !== entry.playerId && p.status === 'active');
  const ready = goal.trim() && excusePickId != null && betPickId != null;

  const lockIn = async () => {
    setBusy(true);
    const ok = await run(
      () => api.updateEntry(gameId, round.id, entry.playerId, { goal, excusePickId, excuseReason, betPickId, betReason, submitted: true }),
      t.round.lockedToast,
    );
    setBusy(false);
    if (ok !== undefined) onDone();
  };

  return (
    <section className="move">
      <header className="move-header">
        <div>
          <p className="eyebrow">{t.round.yourMove}</p>
          <h3 className="move-title">{entry.submitted ? t.round.changeTitle : t.round.planTitle}</h3>
        </div>
        {entry.submitted && (
          <Button size="sm" variant="ghost" onClick={onDone}>
            {t.common.cancel}
          </Button>
        )}
      </header>

      <div className="move-step">
        <span className="move-step-num">1</span>
        <div className="move-step-body">
          <label className="move-step-title" htmlFor="goal">
            {t.round.goal}
          </label>
          <p className="move-step-hint">{t.round.goalHint}</p>
          <AutoTextarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder={t.round.goalPlaceholder} maxLength={500} />
        </div>
      </div>

      <div className="move-step">
        <span className="move-step-num">2</span>
        <div className="move-step-body">
          <span className="move-step-title">{t.round.callTitle}</span>
          <p className="move-step-hint">{t.round.callHint(POINTS.callHit)}</p>
          <PlayerPicker tone="call" label={t.round.callTitle} players={roundPlayers} value={excusePickId} onChange={setExcusePick} />
          <AutoTextarea value={excuseReason} onChange={(e) => setExcuseReason(e.target.value)} placeholder={t.round.why} aria-label={t.round.whyCall} maxLength={500} />
        </div>
      </div>

      <div className="move-step">
        <span className="move-step-num">3</span>
        <div className="move-step-body">
          <span className="move-step-title">{t.round.betTitle}</span>
          <p className="move-step-hint">{t.round.betHint(POINTS.betHit)}</p>
          <PlayerPicker tone="bet" label={t.round.betTitle} players={roundPlayers} value={betPickId} onChange={setBetPick} />
          <AutoTextarea value={betReason} onChange={(e) => setBetReason(e.target.value)} placeholder={t.round.why} aria-label={t.round.whyBet} maxLength={500} />
        </div>
      </div>

      <footer className="move-footer">
        <span className="muted small">{ready ? t.round.readyHint : t.round.notReadyHint}</span>
        <Button variant="primary" size="lg" icon="lock" disabled={!ready} loading={busy} onClick={lockIn}>
          {t.round.lockIt}
        </Button>
      </footer>
    </section>
  );
}

function MoveSummary({ entry }: { entry: Entry }) {
  const { t } = useI18n();
  return (
    <dl className="move-summary">
      <div>
        <dt>{t.round.goalLabel}</dt>
        <dd>
          <span dir="auto">{entry.goal}</span>
        </dd>
      </div>
      <div>
        <dt>{t.round.excusesFrom}</dt>
        <dd>
          <PickChip id={entry.excusePickId} />
          {entry.excuseReason && (
            <span className="reason" dir="auto">
              {entry.excuseReason}
            </span>
          )}
        </dd>
      </div>
      <div>
        <dt>{t.round.delivering}</dt>
        <dd>
          <PickChip id={entry.betPickId} />
          {entry.betReason && (
            <span className="reason" dir="auto">
              {entry.betReason}
            </span>
          )}
        </dd>
      </div>
    </dl>
  );
}

function PickChip({ id, verdict }: { id: number | null; verdict?: boolean }) {
  const { lookup, gameId } = useGame();
  const { t } = useI18n();
  if (id == null) return <span className="muted">{t.common.noPick}</span>;
  const p = lookup.player.get(id);
  return (
    <Link to={`/g/${gameId}/players/${id}`} className="pick-chip">
      <Avatar id={id} name={p?.name ?? '?'} size={22} />
      <span dir="auto">{p?.name ?? t.common.formerPlayer}</span>
      {verdict !== undefined && (
        <span className={`verdict ${verdict ? 'is-right' : 'is-wrong'}`} title={verdict ? t.round.calledIt : t.round.wrongCall}>
          <Icon name={verdict ? 'check' : 'x'} size={12} />
        </span>
      )}
    </Link>
  );
}

const SETTABLE: Exclude<Outcome, 'pending'>[] = ['done', 'partial', 'failed'];

function ReportResult({ round, entry }: { round: Round; entry: Entry }) {
  const { gameId, run, patchLocal } = useGame();
  const { t } = useI18n();
  const [excuse, setExcuse] = useState(entry.excuse);
  useEffect(() => setExcuse(entry.excuse), [entry.excuse]);
  const needsExcuse = entry.outcome === 'failed' || entry.outcome === 'partial';

  const setOutcome = (outcome: Outcome) => {
    const next = entry.outcome === outcome ? 'pending' : outcome;
    patchLocal((s) => ({
      ...s,
      entries: s.entries.map((e) => (e.roundId === round.id && e.playerId === entry.playerId ? { ...e, outcome: next } : e)),
    }));
    run(() => api.updateEntry(gameId, round.id, entry.playerId, { outcome: next }));
  };

  return (
    <section className="move">
      <header className="move-header">
        <div>
          <p className="eyebrow">{t.round.goalThisWeek}</p>
          <h3 className="move-title move-goal" dir="auto">
            {entry.goal || t.round.noGoalSet}
          </h3>
        </div>
      </header>
      <p className="move-step-title">{t.round.howDidItGo}</p>
      <div className="outcome-tiles" role="radiogroup" aria-label={t.round.yourResult}>
        {SETTABLE.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={entry.outcome === o}
            className={`outcome-tile is-${o}`}
            onClick={() => setOutcome(o)}
          >
            <span className="outcome-tile-icon">
              <Icon name={OUTCOME_ICON[o]} size={22} />
            </span>
            <span className="outcome-tile-title">{t.outcome[o]}</span>
            <span className="outcome-tile-hint">{t.common.pointsGain(POINTS[o])}</span>
          </button>
        ))}
      </div>
      {needsExcuse && (
        <div className="excuse-box">
          <label className="move-step-title" htmlFor="excuse">
            {t.round.excuseTitle}
          </label>
          <AutoTextarea
            id="excuse"
            value={excuse}
            onChange={(e) => setExcuse(e.target.value)}
            onBlur={() => excuse.trim() !== entry.excuse && run(() => api.updateEntry(gameId, round.id, entry.playerId, { excuse }), t.round.saved)}
            placeholder={t.round.excusePlaceholder}
            maxLength={1000}
          />
        </div>
      )}
      <ProofUploader entry={entry} />
      <MyNotes round={round} entry={entry} />
    </section>
  );
}

function FinalScore({ entry, entries }: { entry: Entry; entries: Entry[] }) {
  const { lookup } = useGame();
  const { t } = useI18n();
  const outcomes = outcomesByPlayer(entries);
  const points = entryPoints(entry, outcomes);
  const own = isResolved(entry.outcome) ? POINTS[entry.outcome] : 0;
  const call = entry.excusePickId != null ? outcomes.get(entry.excusePickId) === 'failed' : undefined;
  const bet = entry.betPickId != null ? outcomes.get(entry.betPickId) === 'done' : undefined;
  const round = lookup.round.get(entry.roundId)!;

  return (
    <section className="move move-final">
      <div className="final-score">
        <span className="final-points">{points}</span>
        <span className="final-label">{t.round.pointsThisRound}</span>
      </div>
      <ul className="final-breakdown">
        <li>
          <span>
            {t.round.yourGoalLine} · <span className={`outcome-text is-${entry.outcome}`}>{t.outcome[entry.outcome]}</span>
          </span>
          <b dir="ltr">+{own}</b>
        </li>
        <li>
          <span>
            {t.round.excusesFrom} <PickChip id={entry.excusePickId} verdict={call} />
          </span>
          <b dir="ltr">+{call ? POINTS.callHit : 0}</b>
        </li>
        <li>
          <span>
            {t.round.delivering} <PickChip id={entry.betPickId} verdict={bet} />
          </span>
          <b dir="ltr">+{bet ? POINTS.betHit : 0}</b>
        </li>
      </ul>
      <ProofUploader entry={entry} />
      <MyNotes round={round} entry={entry} />
    </section>
  );
}

function MyNotes({ round, entry }: { round: Round; entry: Entry }) {
  const { gameId, run } = useGame();
  const { t } = useI18n();
  const [notes, setNotes] = useState(entry.notes);
  const [open, setOpen] = useState(!!entry.notes);
  useEffect(() => setNotes(entry.notes), [entry.notes]);
  if (!open) {
    return (
      <button className="link-btn my-notes-toggle" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} /> {t.round.addNote}
      </button>
    );
  }
  return (
    <div className="field my-notes">
      <span className="field-label">{t.round.yourNotes}</span>
      <AutoTextarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes.trim() !== entry.notes && run(() => api.updateEntry(gameId, round.id, entry.playerId, { notes }), t.round.noteSaved)}
        placeholder={t.round.notesHint}
        autoFocus={!entry.notes}
        maxLength={4000}
      />
    </div>
  );
}

/* ---------- the table ---------- */

/** One line above the table: picks-hidden note while planning, the tally once results come in. */
function TableSummary({ round, entries }: { round: Round; entries: Entry[] }) {
  const { t } = useI18n();
  if (round.status === 'planning') {
    return (
      <span className="muted small section-note">
        <Icon name="eyeOff" size={14} /> {t.round.picksRevealedLater}
      </span>
    );
  }
  const count = (o: Outcome) => entries.filter((e) => e.outcome === o).length;
  if (!entries.some((e) => isResolved(e.outcome))) return null;
  return (
    <span className="table-tally small">
      <span className="dot dot-done" /> {count('done')}
      <span className="dot dot-partial" /> {count('partial')}
      <span className="dot dot-failed" /> {count('failed')}
      <span className="sr-only">{t.round.summary(count('done'), count('partial'), count('failed'))}</span>
    </span>
  );
}

/** Compact scoreboard: one row per player, details on demand. Sorted by points once scored. */
function ScoreTable({ round, entries }: { round: Round; entries: Entry[] }) {
  const outcomes = outcomesByPlayer(entries);
  const points = new Map(entries.map((e) => [e.playerId, entryPoints(e, outcomes)]));
  const rows = round.status === 'final' ? [...entries].sort((a, b) => points.get(b.playerId)! - points.get(a.playerId)!) : entries;
  const top = Math.max(0, ...points.values());
  const [open, setOpen] = useState<number | null>(null);

  return (
    <ol className={`score-table phase-${round.status}`}>
      {rows.map((e) => (
        <TableRow
          key={e.playerId}
          round={round}
          entry={e}
          entries={entries}
          points={points.get(e.playerId)!}
          rank={round.status === 'final' ? rows.findIndex((x) => points.get(x.playerId) === points.get(e.playerId)) + 1 : undefined}
          leader={round.status === 'final' && top > 0 && points.get(e.playerId) === top}
          open={open === e.playerId}
          onToggle={() => setOpen((o) => (o === e.playerId ? null : e.playerId))}
        />
      ))}
    </ol>
  );
}

function TableRow(props: {
  round: Round;
  entry: Entry;
  entries: Entry[];
  points: number;
  rank?: number;
  leader: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { round, entry: e, entries, open } = props;
  const { lookup, gameId } = useGame();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const player = lookup.player.get(e.playerId);
  const name = lookup.name(e.playerId);
  const outcomes = outcomesByPlayer(entries);
  const scored = round.status !== 'planning';
  const verdict = (id: number | null, expected: Outcome) => {
    const o = id != null ? outcomes.get(id) : undefined;
    return scored && isResolved(o) ? o === expected : undefined;
  };
  const doubters = entries.filter((x) => x.excusePickId === e.playerId);
  const backers = entries.filter((x) => x.betPickId === e.playerId);
  const detailId = `row-${round.id}-${e.playerId}`;

  return (
    <li className={`trow outcome-${scored ? e.outcome : 'none'} ${player?.isMe ? 'is-me' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="trow-main" aria-expanded={open} aria-controls={detailId} onClick={props.onToggle} aria-label={t.round.details(name)}>
        {props.rank !== undefined && <span className={`trow-rank ${props.leader ? 'is-leader' : ''}`}>{props.leader ? <Icon name="crown" size={15} /> : props.rank}</span>}
        <Avatar id={e.playerId} name={name} size={36} />
        <span className="trow-body">
          <span className="trow-name">
            <bdi>{name}</bdi>
            {player?.isMe && <span className="you-tag">{t.common.you}</span>}
            {e.proofs.length > 0 && (
              <span className="trow-proof" title={t.round.withProof(e.proofs.length)}>
                <Icon name="camera" size={13} /> {e.proofs.length}
              </span>
            )}
          </span>
          <span className={`trow-goal ${e.goal ? '' : 'is-empty'}`} dir="auto">
            {e.goal || t.round.noGoalYet}
          </span>
          {e.excuse && scored && (
            <span className="trow-excuse" dir="auto">
              {e.excuse}
            </span>
          )}
        </span>
        <span className="trow-picks">
          {e.hidden ? (
            <span className="trow-hidden">
              <Icon name="eyeOff" size={14} /> {t.round.picksHidden}
            </span>
          ) : (
            <>
              <MiniPick kind="call" label={t.round.callShort} id={e.excusePickId} verdict={verdict(e.excusePickId, 'failed')} />
              <MiniPick kind="bet" label={t.round.betShort} id={e.betPickId} verdict={verdict(e.betPickId, 'done')} />
            </>
          )}
        </span>
        <span className="trow-end">
          {round.status === 'planning' ? (
            e.submitted ? (
              <Pill tone="ink" icon="lock">
                {t.round.lockedIn}
              </Pill>
            ) : (
              <Pill icon="clock">{t.round.deciding}</Pill>
            )
          ) : round.status === 'final' ? (
            <span className={`trow-points ${props.leader ? 'is-leader' : ''}`}>{t.common.points(props.points)}</span>
          ) : (
            <OutcomePill outcome={e.outcome} />
          )}
          <Icon name="chevronDown" size={16} className="trow-chevron" />
        </span>
      </button>

      {open && (
        <div className="trow-detail" id={detailId}>
          {round.status === 'final' && (
            <p className="trow-detail-line">
              <OutcomePill outcome={e.outcome} />
            </p>
          )}
          {!e.hidden && (e.excuseReason || e.betReason) && (
            <dl className="trow-reasons">
              {e.excusePickId != null && e.excuseReason && (
                <div>
                  <dt>
                    {t.round.callShort} · <bdi>{lookup.name(e.excusePickId)}</bdi>
                  </dt>
                  <dd dir="auto">{e.excuseReason}</dd>
                </div>
              )}
              {e.betPickId != null && e.betReason && (
                <div>
                  <dt>
                    {t.round.betShort} · <bdi>{lookup.name(e.betPickId)}</bdi>
                  </dt>
                  <dd dir="auto">{e.betReason}</dd>
                </div>
              )}
            </dl>
          )}
          {scored && (doubters.length > 0 || backers.length > 0) && (
            <p className="trow-detail-line muted small">{t.round.doubtedBacked(doubters.length, backers.length)}</p>
          )}
          {e.proofs.length > 0 && <ProofStrip entry={e} max={6} />}
          <div className="trow-actions">
            <Link to={`/g/${gameId}/players/${e.playerId}`} className="btn btn-ghost btn-sm">
              {t.round.profile}
              <Icon name="chevronRight" size={14} />
            </Link>
            {lookup.isAdmin && (
              <Button size="sm" icon="edit" onClick={() => setEditing(true)} aria-label={t.round.editEntry(name)}>
                {t.round.edit}
              </Button>
            )}
          </div>
        </div>
      )}

      {editing && <AdminEntryModal round={round} entry={e} onClose={() => setEditing(false)} />}
    </li>
  );
}

/** "Excuses → Name ✓" in a tinted chip; green when it came true, struck through when it didn’t. */
function MiniPick({ kind, label, id, verdict }: { kind: 'call' | 'bet'; label: string; id: number | null; verdict?: boolean }) {
  const { lookup } = useGame();
  const { t } = useI18n();
  const state = verdict === undefined ? '' : verdict ? 'is-right' : 'is-wrong';
  return (
    <span className={`mini-pick mini-${kind} ${state}`} title={verdict === undefined ? undefined : verdict ? t.round.calledIt : t.round.wrongCall}>
      <span className="mini-pick-label">{label}</span>
      {id == null ? <span className="muted">—</span> : <bdi className="mini-pick-name">{lookup.name(id)}</bdi>}
      {verdict !== undefined && <Icon name={verdict ? 'check' : 'x'} size={12} />}
    </span>
  );
}

function AdminEntryModal({ round, entry, onClose }: { round: Round; entry: Entry; onClose: () => void }) {
  const { gameId, run, lookup } = useGame();
  const { t } = useI18n();
  const player = lookup.player.get(entry.playerId);
  const isGuest = !player?.hasAccount;
  // Before the reveal, an account's picks are theirs alone. Guests' picks are entered by the admin.
  const canPick = round.status !== 'planning' || isGuest;
  const [goal, setGoal] = useState(entry.goal);
  const [outcome, setOutcome] = useState<Outcome>(entry.outcome);
  const [excuse, setExcuse] = useState(entry.excuse);
  const [excusePickId, setExcusePick] = useState(entry.excusePickId);
  const [betPickId, setBetPick] = useState(entry.betPickId);
  const [busy, setBusy] = useState(false);
  const name = lookup.name(entry.playerId);
  const others = (lookup.entriesByRound.get(round.id) ?? [])
    .map((e) => lookup.player.get(e.playerId)!)
    .filter((p) => p && p.id !== entry.playerId && p.status === 'active');

  const save = async () => {
    setBusy(true);
    const patch = {
      goal,
      ...(canPick ? { excusePickId, betPickId } : {}),
      ...(round.status === 'planning' ? (isGuest ? { submitted: !!goal.trim() } : {}) : { outcome, excuse }),
    };
    const ok = await run(() => api.updateEntry(gameId, round.id, entry.playerId, patch), t.round.saved);
    setBusy(false);
    if (ok !== undefined) onClose();
  };

  const remove = async () => {
    await run(() => api.removeEntry(gameId, round.id, entry.playerId), t.round.removedFromRound(name));
    onClose();
  };

  return (
    <Modal
      title={t.round.editEntry(name)}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={remove}>
            {t.round.removeFromRound}
          </Button>
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {t.common.save}
          </Button>
        </>
      }
    >
      {isGuest && round.status === 'planning' && <p className="muted small modal-note">{t.round.guestMove(name)}</p>}
      <label className="field">
        <span className="field-label">{t.round.goalLabel}</span>
        <AutoTextarea value={goal} onChange={(e) => setGoal(e.target.value)} />
      </label>
      {canPick ? (
        <>
          <div className="field">
            <span className="field-label">{t.round.excusesFrom}</span>
            <PlayerPicker tone="call" label={t.round.excusesFrom} players={others} value={excusePickId} onChange={setExcusePick} />
          </div>
          <div className="field">
            <span className="field-label">{t.round.delivering}</span>
            <PlayerPicker tone="bet" label={t.round.delivering} players={others} value={betPickId} onChange={setBetPick} />
          </div>
        </>
      ) : (
        <p className="muted small modal-note">
          <Icon name="eyeOff" size={14} /> {t.round.picksPrivate(name)}
        </p>
      )}
      {round.status !== 'planning' && (
        <>
          <div className="field">
            <span className="field-label">{t.round.result}</span>
            <div className="segmented">
              {(['pending', 'done', 'partial', 'failed'] as Outcome[]).map((o) => (
                <button key={o} type="button" className={`segment ${outcome === o ? 'is-on' : ''} is-${o}`} onClick={() => setOutcome(o)}>
                  {t.outcome[o]}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="field-label">{t.round.excuse}</span>
            <AutoTextarea value={excuse} onChange={(e) => setExcuse(e.target.value)} />
          </label>
          <ProofUploader entry={entry} />
        </>
      )}
    </Modal>
  );
}

function RoundNotes({ round }: { round: Round }) {
  const { gameId, run } = useGame();
  const { t } = useI18n();
  const [notes, setNotes] = useState(round.notes);
  useEffect(() => setNotes(round.notes), [round.notes]);
  return (
    <section className="section">
      <h3 className="section-title">{t.round.notes}</h3>
      <AutoTextarea
        className="notes-input"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes.trim() !== round.notes && run(() => api.updateRound(gameId, round.id, { notes }), t.round.notesSaved)}
        placeholder={t.round.notesPlaceholder}
        maxLength={8000}
      />
    </section>
  );
}
