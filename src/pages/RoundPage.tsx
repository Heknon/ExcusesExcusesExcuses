import { useEffect, useState, type ReactNode } from 'react';
import { betHit, entryPoints, isResolved, mvpVotes, POINTS, roundContext, type RoundContext } from '../../shared/scoring.ts';
import { isPrePlay, type Entry, type Outcome, type Player, type Round, type RoundStatus } from '../../shared/types.ts';
import { api } from '../api.ts';
import { addDays, defaultDeadline, fromLocalInput, toLocalInput, weekStart } from '../format.ts';
import { DeadlineBadge, fromDrafts, GoalList, GoalReporter, GoalsEditor, GoalSummary, toDrafts } from '../goals.tsx';
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
  const ctx = roundContext(entries);

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
          <DeadlineBadge round={round} />
        </div>
        <PhaseSteps status={round.status} />
      </header>

      {lookup.isAdmin && (round.status !== 'final' || isCurrent) && <AdminBar round={round} entries={entries} />}

      {mine && lookup.me.status === 'active' && <YourMove round={round} entry={mine} entries={entries} ctx={ctx} />}

      {round.status === 'final' && <MvpBanner entries={entries} />}

      <section className="section">
        <div className="section-head">
          <h3 className="section-title">{t.round.table}</h3>
          <TableSummary round={round} entries={entries} />
        </div>
        {entries.length === 0 ? <EmptyState title={t.round.nobody} /> : <ScoreTable round={round} entries={entries} ctx={ctx} />}
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
  const [deadline, setDeadline] = useState(() => toLocalInput(defaultDeadline(suggested)));
  const [deadlineTouched, setDeadlineTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  const changeDate = (d: string) => {
    setDate(d);
    if (!deadlineTouched && d) setDeadline(toLocalInput(defaultDeadline(d)));
  };

  const start = async () => {
    setBusy(true);
    const r = await run(() => api.createRound(gameId, date, fromLocalInput(deadline) ?? defaultDeadline(date)), t.round.opened);
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
          <input type="date" className="input" value={date} onChange={(e) => changeDate(e.target.value)} />
        </label>
        <label className="field field-inline">
          <span className="field-label">{t.round.deadlineLabel}</span>
          <input
            type="datetime-local"
            className="input"
            value={deadline}
            onChange={(e) => {
              setDeadline(e.target.value);
              setDeadlineTouched(true);
            }}
          />
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

type Confirm = null | 'bets' | 'live' | 'final' | 'delete' | 'deadline';

/** Who's still missing for the current phase, and what moves the round forward. */
function AdminBar({ round, entries }: { round: Round; entries: Entry[] }) {
  const { gameId, run, lookup } = useGame();
  const { t, fmt } = useI18n();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [deadline, setDeadline] = useState(toLocalInput(round.deadline));
  const n = entries.length;
  const withGoals = entries.filter((e) => e.goals.length > 0);
  const betted = entries.filter((e) => e.submitted);
  const reported = entries.filter((e) => isResolved(e.outcome));
  const voted = entries.filter((e) => e.voted);
  const missing = (have: Entry[]) =>
    entries
      .filter((e) => !have.includes(e))
      .map((e) => lookup.name(e.playerId))
      .join(', ');

  const setStatus = async (status: RoundStatus) => {
    setConfirm(null);
    const message: Record<RoundStatus, string> = {
      goals: t.round.reopened,
      bets: t.round.betsOpened,
      live: t.round.revealed,
      final: t.round.scored,
    };
    await run(() => api.updateRound(gameId, round.id, { status }), message[status]);
  };

  const progress =
    round.status === 'goals'
      ? { done: withGoals.length, label: t.round.goalsProgress(withGoals.length, n) }
      : round.status === 'bets'
        ? { done: betted.length, label: t.round.lockedProgress(betted.length, n) }
        : { done: reported.length, label: `${t.round.reportedProgress(reported.length, n)} · ${t.round.votedProgress(voted.length, n)}` };

  return (
    <div className="admin-bar">
      <span className="admin-tag">
        <Icon name="crown" size={14} /> {t.common.admin}
      </span>
      {round.status !== 'final' && (
        <div className="admin-progress">
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={n} aria-valuenow={progress.done}>
            <span style={{ width: `${n ? (progress.done / n) * 100 : 0}%` }} />
          </div>
          <span className="small">{progress.label}</span>
        </div>
      )}
      <div className="admin-actions">
        {round.status !== 'final' && (
          <Button
            size="sm"
            variant="ghost"
            icon="clock"
            onClick={() => {
              setDeadline(toLocalInput(round.deadline));
              setConfirm('deadline');
            }}
          >
            {t.round.changeDeadline}
          </Button>
        )}
        {round.status === 'goals' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirm('delete')}>
              {t.round.deleteRound}
            </Button>
            <Button size="sm" variant="primary" icon="target" onClick={() => (withGoals.length < n ? setConfirm('bets') : setStatus('bets'))}>
              {t.round.startBets}
            </Button>
          </>
        )}
        {round.status === 'bets' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setStatus('goals')}>
              {t.round.backToGoals}
            </Button>
            <Button size="sm" variant="primary" icon="eye" onClick={() => (betted.length < n ? setConfirm('live') : setStatus('live'))}>
              {t.round.startWeek}
            </Button>
          </>
        )}
        {round.status === 'live' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setStatus('bets')}>
              {t.round.backToBets}
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon="trophy"
              onClick={() => (reported.length < n || voted.length < n ? setConfirm('final') : setStatus('final'))}
            >
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

      {confirm === 'bets' && (
        <ConfirmModal title={t.round.confirmBetsTitle} cta={t.round.startBets} onCancel={() => setConfirm(null)} onConfirm={() => setStatus('bets')}>
          <p>{t.round.confirmBetsBody(missing(withGoals))}</p>
        </ConfirmModal>
      )}
      {confirm === 'live' && (
        <ConfirmModal title={t.round.confirmStartTitle} cta={t.round.startAnyway} onCancel={() => setConfirm(null)} onConfirm={() => setStatus('live')}>
          <p>{t.round.confirmStartBody(missing(betted))}</p>
        </ConfirmModal>
      )}
      {confirm === 'final' && (
        <ConfirmModal title={t.round.confirmScoreTitle} cta={t.round.scoreAnyway} onCancel={() => setConfirm(null)} onConfirm={() => setStatus('final')}>
          {reported.length < n && <p>{t.round.confirmScoreBody(missing(reported))}</p>}
          {voted.length < n && <p>{t.round.confirmVotesBody(missing(voted))}</p>}
        </ConfirmModal>
      )}
      {confirm === 'deadline' && (
        <ConfirmModal
          title={t.round.changeDeadline}
          cta={t.common.save}
          cancel={t.common.cancel}
          disabled={!fromLocalInput(deadline)}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            await run(() => api.updateRound(gameId, round.id, { deadline: fromLocalInput(deadline)! }), t.round.deadlineSaved);
          }}
        >
          <label className="field">
            <span className="field-label">{t.round.deadlineLabel}</span>
            <input type="datetime-local" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} autoFocus />
          </label>
        </ConfirmModal>
      )}
      {confirm === 'delete' && (
        <ConfirmModal
          title={t.round.confirmDeleteTitle}
          cta={t.round.deleteRound}
          danger
          cancel={t.round.keep}
          onCancel={() => setConfirm(null)}
          onConfirm={async () => {
            setConfirm(null);
            await run(() => api.deleteRound(gameId, round.id), t.round.deleted);
            navigate(`/g/${gameId}`, { replace: true });
          }}
        >
          <p>{t.round.confirmDeleteBody(fmt.weekRange(round.startDate))}</p>
        </ConfirmModal>
      )}
    </div>
  );
}

function ConfirmModal(props: {
  title: string;
  cta: string;
  cancel?: string;
  danger?: boolean;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Modal
      title={props.title}
      onClose={props.onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={props.onCancel}>
            {props.cancel ?? t.round.wait}
          </Button>
          <Button variant={props.danger ? 'danger' : 'primary'} disabled={props.disabled} onClick={props.onConfirm}>
            {props.cta}
          </Button>
        </>
      }
    >
      {props.children}
    </Modal>
  );
}

/* ---------- your move ---------- */

function YourMove({ round, entry, entries, ctx }: { round: Round; entry: Entry; entries: Entry[]; ctx: RoundContext }) {
  switch (round.status) {
    case 'goals':
      return <GoalsCard round={round} entry={entry} />;
    case 'bets':
      return <BetsCard round={round} entry={entry} />;
    case 'live':
      return (
        <>
          <ReportResult round={round} entry={entry} />
          <VoteCard round={round} entry={entry} entries={entries} />
        </>
      );
    case 'final':
      return <FinalScore entry={entry} ctx={ctx} />;
  }
}

/** Phase 1: write your goals. Saved goals show on the table for everyone straight away. */
function GoalsCard({ round, entry }: { round: Round; entry: Entry }) {
  const { gameId, run } = useGame();
  const { t } = useI18n();
  const [editing, setEditing] = useState(entry.goals.length === 0);
  const [goals, setGoals] = useState(() => toDrafts(entry.goals));
  const [busy, setBusy] = useState(false);
  const list = fromDrafts(goals);

  const save = async () => {
    setBusy(true);
    const ok = await run(() => api.updateEntry(gameId, round.id, entry.playerId, { goals: list }), t.round.goalsSaved);
    setBusy(false);
    if (ok !== undefined) setEditing(false);
  };

  if (!editing) {
    return (
      <section className="move move-locked">
        <header className="move-header">
          <div>
            <p className="eyebrow">{t.round.yourMove}</p>
            <h3 className="move-title">
              <Icon name="check" size={18} /> {t.round.goalsIn}
            </h3>
          </div>
          <Button
            size="sm"
            icon="edit"
            onClick={() => {
              setGoals(toDrafts(entry.goals));
              setEditing(true);
            }}
          >
            {t.round.change}
          </Button>
        </header>
        <GoalList goals={entry.goals} showOutcomes={false} />
        <p className="muted small move-foot-note">{t.round.goalsInHint}</p>
      </section>
    );
  }

  return (
    <section className="move">
      <header className="move-header">
        <div>
          <p className="eyebrow">{t.round.yourMove}</p>
          <h3 className="move-title">{t.round.goalsTitle}</h3>
        </div>
        {entry.goals.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t.common.cancel}
          </Button>
        )}
      </header>
      <p className="move-step-hint move-lede">{t.round.goalHint}</p>
      <GoalsEditor value={goals} onChange={setGoals} autoFocus />
      <footer className="move-footer">
        <span className="muted small">{t.round.goalsPhaseHint}</span>
        <Button variant="primary" size="lg" icon="check" disabled={!list.length} loading={busy} onClick={save}>
          {t.round.saveGoals}
        </Button>
      </footer>
    </section>
  );
}

/** Phase 2: everyone's goals are known — pick who'll have excuses and who'll impress most. */
function BetsCard({ round, entry }: { round: Round; entry: Entry }) {
  const { gameId, run, lookup } = useGame();
  const { t } = useI18n();
  const [editing, setEditing] = useState(!entry.submitted);
  const [excusePickId, setExcusePick] = useState(entry.excusePickId);
  const [excuseReason, setExcuseReason] = useState(entry.excuseReason);
  const [betPickId, setBetPick] = useState(entry.betPickId);
  const [betReason, setBetReason] = useState(entry.betReason);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!entry.submitted) setEditing(true);
  }, [entry.submitted]);

  const others = (lookup.entriesByRound.get(round.id) ?? [])
    .map((e) => lookup.player.get(e.playerId)!)
    .filter((p) => p && p.id !== entry.playerId && p.status === 'active');
  const ready = excusePickId != null && betPickId != null;

  const lockIn = async () => {
    setBusy(true);
    const ok = await run(
      () => api.updateEntry(gameId, round.id, entry.playerId, { excusePickId, excuseReason, betPickId, betReason, submitted: true }),
      t.round.betsLocked,
    );
    setBusy(false);
    if (ok !== undefined) setEditing(false);
  };

  if (!editing) {
    return (
      <section className="move move-locked">
        <header className="move-header">
          <div>
            <p className="eyebrow">{t.round.yourMove}</p>
            <h3 className="move-title">
              <Icon name="lock" size={18} /> {t.round.betsLocked}
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

  return (
    <section className="move">
      <header className="move-header">
        <div>
          <p className="eyebrow">{t.round.yourMove}</p>
          <h3 className="move-title">{t.round.betsTitle}</h3>
        </div>
        {entry.submitted && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            {t.common.cancel}
          </Button>
        )}
      </header>
      <p className="move-step-hint move-lede">{t.round.betsHint}</p>

      <div className="move-step">
        <span className="move-step-num">1</span>
        <div className="move-step-body">
          <span className="move-step-title">{t.round.callTitle}</span>
          <p className="move-step-hint">{t.round.callHint(POINTS.callHit)}</p>
          <PlayerPicker tone="call" label={t.round.callTitle} players={others} value={excusePickId} onChange={setExcusePick} />
          <AutoTextarea value={excuseReason} onChange={(e) => setExcuseReason(e.target.value)} placeholder={t.round.why} aria-label={t.round.whyCall} maxLength={500} />
        </div>
      </div>

      <div className="move-step">
        <span className="move-step-num">2</span>
        <div className="move-step-body">
          <span className="move-step-title">{t.round.betTitle}</span>
          <p className="move-step-hint">{t.round.betHint(POINTS.betHit)}</p>
          <PlayerPicker tone="bet" label={t.round.betTitle} players={others} value={betPickId} onChange={setBetPick} />
          <AutoTextarea value={betReason} onChange={(e) => setBetReason(e.target.value)} placeholder={t.round.why} aria-label={t.round.whyBet} maxLength={500} />
        </div>
      </div>

      <footer className="move-footer">
        <span className="muted small">{ready ? t.round.readyHint : t.round.notReadyHint}</span>
        <Button variant="primary" size="lg" icon="lock" disabled={!ready} loading={busy} onClick={lockIn}>
          {t.round.lockBets}
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

/** Phase 3: report each goal, add an excuse if needed, attach proof. */
function ReportResult({ round, entry }: { round: Round; entry: Entry }) {
  const { gameId, run, patchLocal } = useGame();
  const { t } = useI18n();
  const [excuse, setExcuse] = useState(entry.excuse);
  useEffect(() => setExcuse(entry.excuse), [entry.excuse]);
  const needsExcuse = entry.outcome === 'failed' || entry.outcome === 'partial';
  const doneCount = entry.goals.filter((g) => g.outcome === 'done').length;

  // Entries without goals (e.g. an empty import) report one result for the week.
  const setOutcome = (outcome: Outcome) => {
    const next = entry.outcome === outcome ? 'pending' : outcome;
    patchLocal((s) => ({
      ...s,
      entries: s.entries.map((e) => (e.roundId === round.id && e.playerId === entry.playerId ? { ...e, outcome: next } : e)),
    }));
    run(() => api.updateEntry(gameId, round.id, entry.playerId, { outcome: next }));
  };

  return (
    <section className="move move-report">
      <header className="move-header">
        <div>
          <p className="eyebrow">{t.round.goalThisWeek}</p>
          <h3 className="move-title">{t.round.howDidItGo}</h3>
        </div>
        {isResolved(entry.outcome) && (
          <span className="week-result" title={t.round.weekResult}>
            <OutcomePill outcome={entry.outcome} />
            <span className="week-result-points">{t.common.pointsGain(POINTS[entry.outcome])}</span>
          </span>
        )}
      </header>

      {entry.goals.length > 0 ? (
        <>
          <GoalReporter round={round} entry={entry} />
          {entry.goals.length > 1 && !isResolved(entry.outcome) && (
            <p className="muted small report-progress">{t.round.goalsDone(doneCount, entry.goals.length)}</p>
          )}
        </>
      ) : (
        <div className="outcome-tiles" role="radiogroup" aria-label={t.round.yourResult}>
          {SETTABLE.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={entry.outcome === o} className={`outcome-tile is-${o}`} onClick={() => setOutcome(o)}>
              <span className="outcome-tile-icon">
                <Icon name={OUTCOME_ICON[o]} size={22} />
              </span>
              <span className="outcome-tile-title">{t.outcome[o]}</span>
              <span className="outcome-tile-hint">{t.common.pointsGain(POINTS[o])}</span>
            </button>
          ))}
        </div>
      )}

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
      <div className="move-extras">
        <ProofUploader entry={entry} compact />
        <MyNotes round={round} entry={entry} />
      </div>
    </section>
  );
}

/** Phase 3: secret vote for the most impressive week. */
function VoteCard({ round, entry, entries }: { round: Round; entry: Entry; entries: Entry[] }) {
  const { gameId, run, lookup, patchLocal } = useGame();
  const { t } = useI18n();
  const candidates = entries.map((e) => lookup.player.get(e.playerId)!).filter((p) => p && p.id !== entry.playerId);

  const vote = (id: number | null) => {
    patchLocal((s) => ({
      ...s,
      entries: s.entries.map((e) => (e.roundId === round.id && e.playerId === entry.playerId ? { ...e, mvpVoteId: id, voted: id != null } : e)),
    }));
    run(() => api.updateEntry(gameId, round.id, entry.playerId, { mvpVoteId: id }), id != null ? t.round.voteSaved : undefined);
  };

  return (
    <section className="move move-vote">
      <header className="move-header">
        <div>
          <p className="eyebrow eyebrow-icon">
            <Icon name="trophy" size={13} /> {t.round.mvp}
          </p>
          <h3 className="move-title">{t.round.voteTitle}</h3>
        </div>
      </header>
      <PlayerPicker tone="vote" compact label={t.round.voteTitle} players={candidates} value={entry.mvpVoteId} onChange={vote} />
      <p className="muted small vote-hint">{t.round.voteHint(POINTS.mvp, POINTS.betHit)}</p>
    </section>
  );
}

function FinalScore({ entry, ctx }: { entry: Entry; ctx: RoundContext }) {
  const { lookup } = useGame();
  const { t } = useI18n();
  const points = entryPoints(entry, ctx);
  const own = isResolved(entry.outcome) ? POINTS[entry.outcome] : 0;
  const call = entry.excusePickId != null ? ctx.outcomes.get(entry.excusePickId) === 'failed' : undefined;
  const bet = betHit(entry.betPickId, ctx);
  const mvp = ctx.winners?.has(entry.playerId) ?? false;
  const round = lookup.round.get(entry.roundId)!;

  return (
    <section className="move move-final">
      <div className="final-score">
        <span className="final-points">{points}</span>
        <span className="final-label">{t.round.pointsThisRound(points)}</span>
      </div>
      <ul className="final-breakdown">
        <li className="final-goals">
          <span>
            {t.round.yourGoalLine} · <span className={`outcome-text is-${entry.outcome}`}>{t.outcome[entry.outcome]}</span>
          </span>
          <b dir="ltr">+{own}</b>
          {entry.goals.length > 0 && <GoalList goals={entry.goals} showOutcomes />}
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
        {mvp && (
          <li className="final-mvp">
            <span>
              <Icon name="trophy" size={16} /> {t.round.mvpLine}
            </span>
            <b dir="ltr">+{POINTS.mvp}</b>
          </li>
        )}
      </ul>
      <div className="move-extras">
        <ProofUploader entry={entry} compact />
        <MyNotes round={round} entry={entry} />
      </div>
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
      <Button size="sm" variant="ghost" icon="edit" onClick={() => setOpen(true)}>
        {t.round.addNote}
      </Button>
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

/* ---------- results ---------- */

/** Once scored: who the group voted most impressive. */
function MvpBanner({ entries }: { entries: Entry[] }) {
  const { lookup } = useGame();
  const { t } = useI18n();
  const votes = mvpVotes(entries);
  const top = Math.max(0, ...votes.values());
  if (!top) return null;
  const winners = [...votes].filter(([, n]) => n === top).map(([id]) => id);
  return (
    <section className="mvp-banner">
      <span className="mvp-icon">
        <Icon name="trophy" size={22} />
      </span>
      <span className="mvp-body">
        <span className="eyebrow">{t.round.mvp}</span>
        <span className="mvp-names">
          {winners.map((id) => (
            <Avatar key={id} id={id} name={lookup.name(id)} size={30} ring />
          ))}
          <bdi>{winners.map((id) => lookup.name(id)).join(', ')}</bdi>
        </span>
      </span>
      <span className="mvp-votes">{t.round.mvpVotes(top)}</span>
    </section>
  );
}

/* ---------- the table ---------- */

/** One line above the table: picks-hidden note before the reveal, the tally once results come in. */
function TableSummary({ round, entries }: { round: Round; entries: Entry[] }) {
  const { t } = useI18n();
  if (round.status === 'goals') return null;
  if (round.status === 'bets') {
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
function ScoreTable({ round, entries, ctx }: { round: Round; entries: Entry[]; ctx: RoundContext }) {
  const final = round.status === 'final';
  const points = new Map(entries.map((e) => [e.playerId, entryPoints(e, ctx)]));
  const rows = final ? [...entries].sort((a, b) => points.get(b.playerId)! - points.get(a.playerId)!) : entries;
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
          ctx={ctx}
          points={points.get(e.playerId)!}
          rank={final ? rows.findIndex((x) => points.get(x.playerId) === points.get(e.playerId)) + 1 : undefined}
          leader={final && top > 0 && points.get(e.playerId) === top}
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
  ctx: RoundContext;
  points: number;
  rank?: number;
  leader: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const { round, entry: e, entries, ctx, open } = props;
  const { lookup, gameId } = useGame();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const player = lookup.player.get(e.playerId);
  const name = lookup.name(e.playerId);
  const started = !isPrePlay(round.status);
  const final = round.status === 'final';
  const called = e.excusePickId != null ? ctx.outcomes.get(e.excusePickId) : undefined;
  const callVerdict = started && isResolved(called) ? called === 'failed' : undefined;
  // The most-impressive bet is only settled by the vote, at scoring.
  const betVerdict = final ? betHit(e.betPickId, ctx) : undefined;
  const isMvp = final && (ctx.winners?.has(e.playerId) ?? false);
  const doubters = entries.filter((x) => x.excusePickId === e.playerId);
  const backers = entries.filter((x) => x.betPickId === e.playerId);
  const votes = final ? entries.filter((x) => x.mvpVoteId === e.playerId).length : 0;
  const detailId = `row-${round.id}-${e.playerId}`;
  const hasPicks = !e.hidden && (e.excusePickId != null || e.betPickId != null);

  return (
    <li className={`trow outcome-${started ? e.outcome : 'none'} ${player?.isMe ? 'is-me' : ''} ${open ? 'is-open' : ''}`}>
      <button type="button" className="trow-main" aria-expanded={open} aria-controls={detailId} onClick={props.onToggle} aria-label={t.round.details(name)}>
        {props.rank !== undefined && <span className={`trow-rank ${props.leader ? 'is-leader' : ''}`}>{props.leader ? <Icon name="crown" size={15} /> : props.rank}</span>}
        <Avatar id={e.playerId} name={name} size={36} />
        <span className="trow-body">
          <span className="trow-name">
            <bdi>{name}</bdi>
            {player?.isMe && <span className="you-tag">{t.common.you}</span>}
            {isMvp && (
              <span className="mvp-tag" title={t.round.mvp}>
                <Icon name="trophy" size={12} /> {t.round.mvp}
              </span>
            )}
            {e.proofs.length > 0 && (
              <span className="trow-proof" title={t.round.withProof(e.proofs.length)}>
                <Icon name="camera" size={13} /> {e.proofs.length}
              </span>
            )}
          </span>
          {!e.goals.length ? (
            <span className="trow-goal is-empty">{t.round.noGoalYet}</span>
          ) : started && !open ? (
            <GoalSummary goals={e.goals} showOutcomes />
          ) : (
            // Before the week, the goals are what everyone bets on, so they stay readable.
            <GoalList goals={e.goals} showOutcomes={started} limit={open ? undefined : 2} inline />
          )}
          {e.excuse && open && (
            <span className="trow-excuse" dir="auto">
              {e.excuse}
            </span>
          )}
        </span>
        <span className="trow-picks">
          {hasPicks && (open || !started || round.status === 'final') && (
            <>
              <MiniPick kind="call" label={t.round.callShort} id={e.excusePickId} verdict={callVerdict} />
              <MiniPick kind="bet" label={t.round.betShort} id={e.betPickId} verdict={betVerdict} />
            </>
          )}
        </span>
        <span className="trow-end">
          <RowStatus round={round} entry={e} points={props.points} leader={props.leader} />
          <Icon name="chevronDown" size={16} className="trow-chevron" />
        </span>
      </button>

      {open && (
        <div className="trow-detail" id={detailId}>
          {final && (
            <p className="trow-detail-line trow-detail-pills">
              <OutcomePill outcome={e.outcome} />
              {votes > 0 && (
                <Pill icon="trophy" tone="planning">
                  {t.round.mvpVotes(votes)}
                </Pill>
              )}
            </p>
          )}
          {!e.hidden && (e.excuseReason || e.betReason || (final && e.mvpVoteId != null)) && (
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
                    {t.round.delivering} · <bdi>{lookup.name(e.betPickId)}</bdi>
                  </dt>
                  <dd dir="auto">{e.betReason}</dd>
                </div>
              )}
              {final && e.mvpVoteId != null && (
                <div>
                  <dt>{t.round.votedFor}</dt>
                  <dd>
                    <bdi>{lookup.name(e.mvpVoteId)}</bdi>
                  </dd>
                </div>
              )}
            </dl>
          )}
          {started && (doubters.length > 0 || backers.length > 0) && (
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

/** The pill at the end of a row: what this player still owes in the current phase, or their score. */
function RowStatus({ round, entry: e, points, leader }: { round: Round; entry: Entry; points: number; leader: boolean }) {
  const { t } = useI18n();
  switch (round.status) {
    case 'goals':
      return e.goals.length ? (
        <Pill tone="ink" icon="check">
          {t.round.goalsReady}
        </Pill>
      ) : (
        <Pill icon="clock">{t.round.writing}</Pill>
      );
    case 'bets':
      return e.submitted ? (
        <Pill tone="ink" icon="lock">
          {t.round.lockedIn}
        </Pill>
      ) : (
        <Pill icon="clock">{t.round.deciding}</Pill>
      );
    case 'live':
      return <OutcomePill outcome={e.outcome} />;
    case 'final':
      return <span className={`trow-points ${leader ? 'is-leader' : ''}`}>{t.common.points(points)}</span>;
  }
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

/** Admins fix entries. Before the reveal, an account's picks and vote are theirs alone; guests' are the admin's to enter. */
function AdminEntryModal({ round, entry, onClose }: { round: Round; entry: Entry; onClose: () => void }) {
  const { gameId, run, lookup } = useGame();
  const { t } = useI18n();
  const player = lookup.player.get(entry.playerId);
  const isGuest = !player?.hasAccount;
  const canPick = round.status !== 'goals' && (!isPrePlay(round.status) || isGuest);
  const canVote = isGuest && (round.status === 'live' || round.status === 'final');
  const [goals, setGoals] = useState(() => toDrafts(entry.goals));
  const [outcome, setOutcome] = useState<Outcome>(entry.outcome);
  const [excuse, setExcuse] = useState(entry.excuse);
  const [excusePickId, setExcusePick] = useState(entry.excusePickId);
  const [betPickId, setBetPick] = useState(entry.betPickId);
  const [mvpVoteId, setVote] = useState(entry.mvpVoteId);
  const [busy, setBusy] = useState(false);
  const name = lookup.name(entry.playerId);
  const others = (lookup.entriesByRound.get(round.id) ?? [])
    .map((e) => lookup.player.get(e.playerId)!)
    .filter((p) => p && p.id !== entry.playerId && p.status === 'active');

  const save = async () => {
    setBusy(true);
    const goalList = fromDrafts(goals);
    const patch = {
      goals: goalList,
      ...(canPick ? { excusePickId, betPickId } : {}),
      ...(canPick && round.status === 'bets' ? { submitted: excusePickId != null && betPickId != null } : {}),
      ...(canVote ? { mvpVoteId } : {}),
      ...(!isPrePlay(round.status) ? { excuse, ...(goalList.length === 0 ? { outcome } : {}) } : {}),
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
      {isGuest && isPrePlay(round.status) && <p className="muted small modal-note">{t.round.guestMove(name)}</p>}
      <div className="field">
        <span className="field-label">{t.round.goalLabel}</span>
        <GoalsEditor value={goals} onChange={setGoals} />
      </div>
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
        round.status === 'bets' && (
          <p className="muted small modal-note">
            <Icon name="eyeOff" size={14} /> {t.round.picksPrivate(name)}
          </p>
        )
      )}
      {!isPrePlay(round.status) && (
        <>
          {entry.goals.length > 0 ? (
            <div className="field">
              <span className="field-label">{t.round.result}</span>
              <GoalReporter round={round} entry={entry} />
            </div>
          ) : (
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
          )}
          <label className="field">
            <span className="field-label">{t.round.excuse}</span>
            <AutoTextarea value={excuse} onChange={(e) => setExcuse(e.target.value)} />
          </label>
          {canVote && (
            <div className="field">
              <span className="field-label">{t.round.voteTitle}</span>
              <PlayerPicker tone="vote" label={t.round.voteTitle} players={others} value={mvpVoteId} onChange={setVote} />
            </div>
          )}
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
  const [open, setOpen] = useState(!!round.notes);
  useEffect(() => setNotes(round.notes), [round.notes]);
  useEffect(() => {
    if (round.notes) setOpen(true);
  }, [round.notes]);
  if (!open) {
    return (
      <div className="section notes-toggle">
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setOpen(true)}>
          {t.round.notes}
        </Button>
      </div>
    );
  }
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
        autoFocus={!round.notes}
      />
    </section>
  );
}
