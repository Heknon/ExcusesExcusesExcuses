import { useEffect, useState } from 'react';
import { entryPoints, isResolved, outcomesByPlayer, POINTS } from '../../shared/scoring.ts';
import type { Entry, Outcome, Player, Round } from '../../shared/types.ts';
import { api } from '../api.ts';
import { addDays, daysLeft, OUTCOME_LABEL, plural, weekRange, weekStart } from '../format.ts';
import { Link, navigate } from '../router.tsx';
import { useGame } from '../session.tsx';
import {
  AutoTextarea,
  Avatar,
  Button,
  EmptyState,
  Icon,
  Modal,
  OutcomePill,
  PhaseSteps,
  Pill,
  PlayerPicker,
} from '../ui.tsx';

export function RoundPage({ roundId }: { roundId?: number }) {
  const { lookup, gameId } = useGame();
  const round = roundId ? lookup.round.get(roundId) : lookup.current;

  if (!round) {
    if (roundId) return <EmptyState icon="x" title="Round not found" />;
    return lookup.isAdmin ? (
      <StartRoundCard first />
    ) : (
      <EmptyState icon="clock" title="No rounds yet">
        The first round starts when the admin opens it. You’ll set your goal and make your picks then.
      </EmptyState>
    );
  }

  const index = lookup.rounds.indexOf(round);
  const number = lookup.rounds.length - index;
  const newer = lookup.rounds[index - 1];
  const older = lookup.rounds[index + 1];
  const entries = (lookup.entriesByRound.get(round.id) ?? []).slice().sort((a, b) => seat(lookup.player.get(a.playerId)) - seat(lookup.player.get(b.playerId)));
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
              <Link to={`/g/${gameId}/rounds/${older.id}`} className="icon-btn" aria-label="Previous round">
                <Icon name="chevronLeft" />
              </Link>
            ) : (
              <span className="icon-btn is-disabled" />
            )}
            <span className="eyebrow">Round {number}</span>
            {newer ? (
              <Link to={newer === lookup.current ? `/g/${gameId}` : `/g/${gameId}/rounds/${newer.id}`} className="icon-btn" aria-label="Next round">
                <Icon name="chevronRight" />
              </Link>
            ) : (
              <span className="icon-btn is-disabled" />
            )}
          </div>
          <h2 className="display round-title">{weekRange(round.startDate)}</h2>
          {round.title && (
            <p className="round-subtitle" dir="auto">
              {round.title}
            </p>
          )}
          {round.status === 'live' && left > 0 && <Pill tone="live" icon="clock">{left === 1 ? 'Last day' : `${left} days left`}</Pill>}
          {round.status === 'live' && left <= 0 && <Pill tone="live" icon="clock">Week’s over — report your result</Pill>}
        </div>
        <PhaseSteps status={round.status} />
      </header>

      {lookup.isAdmin && (round.status !== 'final' || isCurrent) && <AdminBar round={round} entries={entries} />}

      {mine && lookup.me.status === 'active' && <YourMove round={round} entry={mine} entries={entries} />}

      {round.status === 'final' && <RoundResults entries={entries} />}

      <section className="section">
        <div className="section-head">
          <h3 className="section-title">The table</h3>
          {round.status === 'planning' && (
            <span className="muted small">
              <Icon name="eyeOff" size={14} /> Picks are revealed when the week starts
            </span>
          )}
        </div>
        {entries.length === 0 ? (
          <EmptyState title="No one is in this round." />
        ) : (
          <ul className="table-grid">
            {entries.map((e) => (
              <li key={e.playerId}>
                <PlayerCard round={round} entry={e} entries={entries} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <RoundNotes round={round} />
    </div>
  );
}

const seat = (p: Player | undefined) => (p?.isMe ? -1 : p?.id ?? 0);

/* ---------- admin ---------- */

function StartRoundCard({ first, after }: { first?: boolean; after?: Round }) {
  const { gameId, run, lookup } = useGame();
  const taken = new Set(lookup.rounds.map((r) => r.startDate));
  let suggested = after ? addDays(after.startDate, 7) : weekStart();
  if (after && suggested < weekStart()) suggested = weekStart();
  while (taken.has(suggested)) suggested = addDays(suggested, 7);
  const [date, setDate] = useState(suggested);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    const r = await run(() => api.createRound(gameId, date), 'Round opened');
    setBusy(false);
    if (r) navigate(`/g/${gameId}`, { keepScroll: true });
  };

  return (
    <div className="start-round">
      <div>
        <h2 className="start-round-title">{first ? 'Start the first round' : 'Ready for the next round?'}</h2>
        <p className="muted">
          {lookup.active.length < 2
            ? 'You’ll want at least two players. Share the invite link from the Players tab first.'
            : `Everyone sets a goal and makes their picks in secret. ${plural(lookup.active.length, 'player')} will be dealt in.`}
        </p>
      </div>
      <div className="start-round-actions">
        <label className="field field-inline">
          <span className="field-label">Week of</span>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <Button variant="primary" icon="flag" loading={busy} onClick={start}>
          Open round
        </Button>
      </div>
      {first && (
        <p className="muted small">
          Already playing in WhatsApp? <Link to={`/g/${gameId}/settings#import`}>Import a round</Link> instead.
        </p>
      )}
    </div>
  );
}

function AdminBar({ round, entries }: { round: Round; entries: Entry[] }) {
  const { gameId, run, lookup } = useGame();
  const [confirm, setConfirm] = useState<null | 'live' | 'final' | 'delete'>(null);
  const locked = entries.filter((e) => e.submitted).length;
  const reported = entries.filter((e) => isResolved(e.outcome)).length;
  const missing = (pred: (e: Entry) => boolean) => entries.filter((e) => !pred(e)).map((e) => lookup.name(e.playerId));

  const setStatus = async (status: Round['status']) => {
    setConfirm(null);
    await run(() => api.updateRound(gameId, round.id, { status }), status === 'live' ? 'Picks revealed. The week is on.' : status === 'final' ? 'Round scored' : 'Round reopened');
  };

  const progress = round.status === 'planning' ? locked : reported;
  const verb = round.status === 'planning' ? 'locked in' : 'reported';

  return (
    <div className="admin-bar">
      <span className="admin-tag">
        <Icon name="crown" size={14} /> Admin
      </span>
      {round.status !== 'final' && (
        <div className="admin-progress">
          <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={entries.length} aria-valuenow={progress}>
            <span style={{ width: `${entries.length ? (progress / entries.length) * 100 : 0}%` }} />
          </div>
          <span className="small">
            {progress} of {entries.length} {verb}
          </span>
        </div>
      )}
      <div className="admin-actions">
        {round.status === 'planning' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirm('delete')}>
              Delete round
            </Button>
            <Button size="sm" variant="primary" icon="eye" onClick={() => (locked < entries.length ? setConfirm('live') : setStatus('live'))}>
              Start the week
            </Button>
          </>
        )}
        {round.status === 'live' && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setStatus('planning')}>
              Back to planning
            </Button>
            <Button size="sm" variant="primary" icon="trophy" onClick={() => (reported < entries.length ? setConfirm('final') : setStatus('final'))}>
              Score the round
            </Button>
          </>
        )}
        {round.status === 'final' && (
          <Button size="sm" variant="ghost" onClick={() => setStatus('live')}>
            Reopen results
          </Button>
        )}
      </div>

      {confirm === 'live' && (
        <Modal
          title="Start the week?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Wait
              </Button>
              <Button variant="primary" onClick={() => setStatus('live')}>
                Start anyway
              </Button>
            </>
          }
        >
          <p>
            Not everyone has locked in: <b dir="auto">{missing((e) => e.submitted).join(', ')}</b>. Starting reveals everyone’s picks and locks goals for the week.
          </p>
        </Modal>
      )}
      {confirm === 'final' && (
        <Modal
          title="Score the round?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Wait
              </Button>
              <Button variant="primary" onClick={() => setStatus('final')}>
                Score anyway
              </Button>
            </>
          }
        >
          <p>
            Still no result from <b dir="auto">{missing((e) => isResolved(e.outcome)).join(', ')}</b>. They’ll score nothing for their own goal unless you set it on their card first.
          </p>
        </Modal>
      )}
      {confirm === 'delete' && (
        <Modal
          title="Delete this round?"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Keep it
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  setConfirm(null);
                  await run(() => api.deleteRound(gameId, round.id), 'Round deleted');
                  navigate(`/g/${gameId}`, { replace: true });
                }}
              >
                Delete round
              </Button>
            </>
          }
        >
          <p>Everyone’s goals and picks for {weekRange(round.startDate)} will be lost.</p>
        </Modal>
      )}
    </div>
  );
}

/* ---------- your move ---------- */

function YourMove({ round, entry, entries }: { round: Round; entry: Entry; entries: Entry[] }) {
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
            <p className="eyebrow">Your move</p>
            <h3 className="move-title">
              <Icon name="lock" size={18} /> Locked in
            </h3>
          </div>
          <Button size="sm" icon="edit" onClick={() => setEditing(true)}>
            Change
          </Button>
        </header>
        <MoveSummary entry={entry} />
        <p className="muted small">You can change your move until the admin starts the week.</p>
      </section>
    );
  }
  if (round.status === 'live') return <ReportResult round={round} entry={entry} />;
  return <FinalScore entry={entry} entries={entries} />;
}

function MoveForm({ round, entry, onDone }: { round: Round; entry: Entry; onDone: () => void }) {
  const { gameId, run, lookup } = useGame();
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
      'Locked in',
    );
    setBusy(false);
    if (ok !== undefined) onDone();
  };

  return (
    <section className="move">
      <header className="move-header">
        <div>
          <p className="eyebrow">Your move</p>
          <h3 className="move-title">{entry.submitted ? 'Change your move' : 'What’s the plan this week?'}</h3>
        </div>
        {entry.submitted && (
          <Button size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </header>

      <div className="move-step">
        <span className="move-step-num">1</span>
        <div className="move-step-body">
          <label className="move-step-title" htmlFor="goal">
            Your goal
          </label>
          <p className="move-step-hint">Something specific you can clearly say you did or didn’t do by Saturday.</p>
          <AutoTextarea id="goal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="e.g. Run 5 km on Friday" maxLength={500} />
        </div>
      </div>

      <div className="move-step">
        <span className="move-step-num">2</span>
        <div className="move-step-body">
          <span className="move-step-title">Who’ll come back with excuses?</span>
          <p className="move-step-hint">+{POINTS.callHit} if they miss. Nobody sees this until the week starts.</p>
          <PlayerPicker tone="call" label="Who’ll come back with excuses" players={roundPlayers} value={excusePickId} onChange={setExcusePick} />
          <AutoTextarea value={excuseReason} onChange={(e) => setExcuseReason(e.target.value)} placeholder="Why? (optional)" aria-label="Why they’ll have excuses" maxLength={500} />
        </div>
      </div>

      <div className="move-step">
        <span className="move-step-num">3</span>
        <div className="move-step-body">
          <span className="move-step-title">Who’ll actually deliver?</span>
          <p className="move-step-hint">+{POINTS.betHit} if they get it done.</p>
          <PlayerPicker tone="bet" label="Who’ll deliver" players={roundPlayers} value={betPickId} onChange={setBetPick} />
          <AutoTextarea value={betReason} onChange={(e) => setBetReason(e.target.value)} placeholder="Why? (optional)" aria-label="Why they’ll deliver" maxLength={500} />
        </div>
      </div>

      <footer className="move-footer">
        <span className="muted small">{ready ? 'You can change this until the week starts.' : 'Set a goal and make both picks to lock in.'}</span>
        <Button variant="primary" size="lg" icon="lock" disabled={!ready} loading={busy} onClick={lockIn}>
          Lock it in
        </Button>
      </footer>
    </section>
  );
}

function MoveSummary({ entry }: { entry: Entry }) {
  return (
    <dl className="move-summary">
      <div>
        <dt>Goal</dt>
        <dd>
          <span dir="auto">{entry.goal}</span>
        </dd>
      </div>
      <div>
        <dt>Excuses from</dt>
        <dd>
          <PickChip id={entry.excusePickId} />
          {entry.excuseReason && <span className="reason" dir="auto">{entry.excuseReason}</span>}
        </dd>
      </div>
      <div>
        <dt>Delivering</dt>
        <dd>
          <PickChip id={entry.betPickId} />
          {entry.betReason && <span className="reason" dir="auto">{entry.betReason}</span>}
        </dd>
      </div>
    </dl>
  );
}

function PickChip({ id, verdict }: { id: number | null; verdict?: boolean }) {
  const { lookup, gameId } = useGame();
  if (id == null) return <span className="muted">No pick</span>;
  const p = lookup.player.get(id);
  return (
    <Link to={`/g/${gameId}/players/${id}`} className="pick-chip">
      <Avatar id={id} name={p?.name ?? '?'} size={22} />
      <span dir="auto">{p?.name ?? 'Former player'}</span>
      {verdict !== undefined && (
        <span className={`verdict ${verdict ? 'is-right' : 'is-wrong'}`} title={verdict ? 'Called it' : 'Wrong call'}>
          <Icon name={verdict ? 'check' : 'x'} size={12} />
        </span>
      )}
    </Link>
  );
}

const SETTABLE: { outcome: Outcome; title: string; hint: string }[] = [
  { outcome: 'done', title: 'Done', hint: `+${POINTS.done}` },
  { outcome: 'partial', title: 'Partly', hint: `+${POINTS.partial}` },
  { outcome: 'failed', title: 'Missed', hint: `+${POINTS.failed}` },
];

function ReportResult({ round, entry }: { round: Round; entry: Entry }) {
  const { gameId, run, patchLocal } = useGame();
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
          <p className="eyebrow">Your goal this week</p>
          <h3 className="move-title move-goal" dir="auto">
            {entry.goal || 'No goal set'}
          </h3>
        </div>
      </header>
      <p className="move-step-title">How did it go?</p>
      <div className="outcome-tiles" role="radiogroup" aria-label="Your result">
        {SETTABLE.map((o) => (
          <button
            key={o.outcome}
            type="button"
            role="radio"
            aria-checked={entry.outcome === o.outcome}
            className={`outcome-tile is-${o.outcome}`}
            onClick={() => setOutcome(o.outcome)}
          >
            <span className="outcome-tile-icon">
              <Icon name={o.outcome === 'done' ? 'check' : o.outcome === 'partial' ? 'target' : 'x'} size={22} />
            </span>
            <span className="outcome-tile-title">{o.title}</span>
            <span className="outcome-tile-hint">{o.hint} {o.hint === '+1' ? 'pt' : 'pts'}</span>
          </button>
        ))}
      </div>
      {needsExcuse && (
        <div className="excuse-box">
          <label className="move-step-title" htmlFor="excuse">
            Let’s hear the excuse
          </label>
          <AutoTextarea
            id="excuse"
            value={excuse}
            onChange={(e) => setExcuse(e.target.value)}
            onBlur={() => excuse.trim() !== entry.excuse && run(() => api.updateEntry(gameId, round.id, entry.playerId, { excuse }), 'Saved')}
            placeholder="What got in the way?"
            maxLength={1000}
          />
        </div>
      )}
      <MyNotes round={round} entry={entry} />
    </section>
  );
}

function FinalScore({ entry, entries }: { entry: Entry; entries: Entry[] }) {
  const { lookup } = useGame();
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
        <span className="final-label">points this round</span>
      </div>
      <ul className="final-breakdown">
        <li>
          <span>
            Your goal · <OutcomeText outcome={entry.outcome} />
          </span>
          <b>+{own}</b>
        </li>
        <li>
          <span>
            Excuses from <PickChip id={entry.excusePickId} verdict={call} />
          </span>
          <b>+{call ? POINTS.callHit : 0}</b>
        </li>
        <li>
          <span>
            Delivering <PickChip id={entry.betPickId} verdict={bet} />
          </span>
          <b>+{bet ? POINTS.betHit : 0}</b>
        </li>
      </ul>
      <MyNotes round={round} entry={entry} />
    </section>
  );
}

function OutcomeText({ outcome }: { outcome: Outcome }) {
  return <span className={`outcome-text is-${outcome}`}>{OUTCOME_LABEL[outcome]}</span>;
}

function MyNotes({ round, entry }: { round: Round; entry: Entry }) {
  const { gameId, run } = useGame();
  const [notes, setNotes] = useState(entry.notes);
  const [open, setOpen] = useState(!!entry.notes);
  useEffect(() => setNotes(entry.notes), [entry.notes]);
  if (!open) {
    return (
      <button className="link-btn" onClick={() => setOpen(true)}>
        <Icon name="plus" size={14} /> Add a note for future you
      </button>
    );
  }
  return (
    <div className="field my-notes">
      <span className="field-label">Your notes</span>
      <AutoTextarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes.trim() !== entry.notes && run(() => api.updateEntry(gameId, round.id, entry.playerId, { notes }), 'Note saved')}
        placeholder="What worked, what didn’t, what to try next time"
        autoFocus={!entry.notes}
        maxLength={4000}
      />
    </div>
  );
}

/* ---------- results ---------- */

function RoundResults({ entries }: { entries: Entry[] }) {
  const { lookup } = useGame();
  const outcomes = outcomesByPlayer(entries);
  const scored = entries.map((e) => ({ e, points: entryPoints(e, outcomes) })).sort((a, b) => b.points - a.points);
  const top = scored[0]?.points ?? 0;
  const leaders = scored.filter((s) => s.points === top && top > 0);
  const count = (o: Outcome) => entries.filter((e) => e.outcome === o).length;

  return (
    <section className="results">
      <div className="results-stat">
        <span className="results-num is-done">{count('done')}</span>
        <span className="results-label">delivered</span>
      </div>
      <div className="results-stat">
        <span className="results-num is-partial">{count('partial')}</span>
        <span className="results-label">partly</span>
      </div>
      <div className="results-stat">
        <span className="results-num is-failed">{count('failed')}</span>
        <span className="results-label">missed</span>
      </div>
      {leaders.length > 0 && (
        <div className="results-leader">
          <span className="results-label">Top score</span>
          <span className="results-leader-names">
            {leaders.map(({ e }) => (
              <Avatar key={e.playerId} id={e.playerId} name={lookup.name(e.playerId)} size={28} ring />
            ))}
            <span dir="auto">{leaders.map(({ e }) => lookup.name(e.playerId)).join(', ')}</span>
            <b>{plural(top, 'pt')}</b>
          </span>
        </div>
      )}
    </section>
  );
}

/* ---------- the table ---------- */

function PlayerCard({ round, entry: e, entries }: { round: Round; entry: Entry; entries: Entry[] }) {
  const { lookup, gameId } = useGame();
  const [editing, setEditing] = useState(false);
  const player = lookup.player.get(e.playerId);
  const outcomes = outcomesByPlayer(entries);
  // The server already hides what this viewer may not see (other accounts' picks during planning).
  const revealed = !e.hidden;
  const doubters = entries.filter((x) => x.excusePickId === e.playerId).length;
  const backers = entries.filter((x) => x.betPickId === e.playerId).length;
  const verdict = (id: number | null, expected: Outcome) => {
    const o = id != null ? outcomes.get(id) : undefined;
    return isResolved(o) ? o === expected : undefined;
  };

  return (
    <article className={`player-card ${player?.isMe ? 'is-me' : ''} outcome-${round.status === 'planning' ? 'none' : e.outcome}`}>
      <header className="player-card-head">
        <Link to={`/g/${gameId}/players/${e.playerId}`} className="player-card-who">
          <Avatar id={e.playerId} name={lookup.name(e.playerId)} size={36} />
          <span className="player-card-name" dir="auto">
            {lookup.name(e.playerId)}
          </span>
          {player?.isMe && <span className="you-tag">You</span>}
        </Link>
        {round.status === 'planning' ? (
          e.submitted ? (
            <Pill tone="ink" icon="lock">
              Locked in
            </Pill>
          ) : (
            <Pill icon="clock">Deciding</Pill>
          )
        ) : (
          <OutcomePill outcome={e.outcome} />
        )}
      </header>

      <p className={`player-card-goal ${e.goal ? '' : 'is-empty'}`} dir="auto">
        {e.goal || 'No goal yet'}
      </p>

      {e.excuse && round.status !== 'planning' && (
        <blockquote className="player-card-excuse" dir="auto">
          {e.excuse}
        </blockquote>
      )}

      {revealed ? (
        <div className="player-card-picks">
          <div className="pick-row">
            <span className="pick-label">Excuses from</span>
            <PickChip id={e.excusePickId} verdict={round.status !== 'planning' ? verdict(e.excusePickId, 'failed') : undefined} />
          </div>
          <div className="pick-row">
            <span className="pick-label">Delivering</span>
            <PickChip id={e.betPickId} verdict={round.status !== 'planning' ? verdict(e.betPickId, 'done') : undefined} />
          </div>
        </div>
      ) : (
        <div className="player-card-hidden">
          <Icon name="eyeOff" size={15} /> Picks hidden
        </div>
      )}

      <footer className="player-card-foot">
        {round.status !== 'planning' ? (
          <span className="muted small">
            Doubted by {doubters} · Backed by {backers}
          </span>
        ) : (
          <span />
        )}
        {round.status === 'final' && <span className="player-card-points">{plural(entryPoints(e, outcomes), 'pt')}</span>}
        {lookup.isAdmin && (
          <button className="icon-btn icon-btn-sm" onClick={() => setEditing(true)} aria-label={`Edit ${lookup.name(e.playerId)}’s entry`}>
            <Icon name="edit" size={15} />
          </button>
        )}
      </footer>

      {editing && <AdminEntryModal round={round} entry={e} onClose={() => setEditing(false)} />}
    </article>
  );
}

function AdminEntryModal({ round, entry, onClose }: { round: Round; entry: Entry; onClose: () => void }) {
  const { gameId, run, lookup } = useGame();
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
    const ok = await run(() => api.updateEntry(gameId, round.id, entry.playerId, patch), 'Saved');
    setBusy(false);
    if (ok !== undefined) onClose();
  };

  const remove = async () => {
    await run(() => api.removeEntry(gameId, round.id, entry.playerId), `${name} removed from the round`);
    onClose();
  };

  return (
    <Modal
      title={`Edit ${name}’s entry`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={remove}>
            Remove from round
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      {isGuest && round.status === 'planning' && (
        <p className="muted small modal-note">{name} is a guest without an account, so you play their move for them.</p>
      )}
      <label className="field">
        <span className="field-label">Goal</span>
        <AutoTextarea value={goal} onChange={(e) => setGoal(e.target.value)} />
      </label>
      {canPick ? (
        <>
          <div className="field">
            <span className="field-label">Excuses from</span>
            <PlayerPicker tone="call" label="Excuses from" players={others} value={excusePickId} onChange={setExcusePick} />
          </div>
          <div className="field">
            <span className="field-label">Delivering</span>
            <PlayerPicker tone="bet" label="Delivering" players={others} value={betPickId} onChange={setBetPick} />
          </div>
        </>
      ) : (
        <p className="muted small modal-note">
          <Icon name="eyeOff" size={14} /> {name}’s picks stay private until the week starts — even from admins.
        </p>
      )}
      {round.status !== 'planning' && (
        <>
          <div className="field">
            <span className="field-label">Result</span>
            <div className="segmented">
              {(['pending', 'done', 'partial', 'failed'] as Outcome[]).map((o) => (
                <button key={o} type="button" className={`segment ${outcome === o ? 'is-on' : ''} is-${o}`} onClick={() => setOutcome(o)}>
                  {OUTCOME_LABEL[o]}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="field-label">Excuse</span>
            <AutoTextarea value={excuse} onChange={(e) => setExcuse(e.target.value)} />
          </label>
        </>
      )}
    </Modal>
  );
}

function RoundNotes({ round }: { round: Round }) {
  const { gameId, run } = useGame();
  const [notes, setNotes] = useState(round.notes);
  useEffect(() => setNotes(round.notes), [round.notes]);
  return (
    <section className="section">
      <h3 className="section-title">Round notes</h3>
      <AutoTextarea
        className="notes-input"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes.trim() !== round.notes && run(() => api.updateRound(gameId, round.id, { notes }), 'Notes saved')}
        placeholder="Anything the group should remember about this week. Everyone can edit this."
        maxLength={8000}
      />
    </section>
  );
}
