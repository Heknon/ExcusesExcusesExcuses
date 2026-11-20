import { useMemo, type ReactNode } from 'react';
import { computeStats, entryPoints, isResolved, outcomesByPlayer, ratio } from '../../shared/scoring.ts';
import type { Entry, Round } from '../../shared/types.ts';
import { OUTCOME_LABEL, percent, plural, shortDate, weekRange } from '../format.ts';
import { Link } from '../router.tsx';
import { useGame } from '../session.tsx';
import { Avatar, EmptyState, Icon, OutcomeDot, OutcomePill, Pill } from '../ui.tsx';

export function PlayerPage({ playerId }: { playerId: number }) {
  const { state, lookup, gameId } = useGame();
  const player = lookup.player.get(playerId);
  const finals = useMemo(() => lookup.rounds.filter((r) => r.status === 'final'), [lookup.rounds]);
  const stats = useMemo(
    () => computeStats(state.players, finals, state.entries).find((s) => s.playerId === playerId),
    [state, finals, playerId],
  );
  if (!player || !stats) return <EmptyState icon="x" title="Player not found" />;

  const history = (lookup.entriesByPlayer.get(playerId) ?? [])
    .map((entry) => ({ entry, round: lookup.round.get(entry.roundId)! }))
    .filter((x) => x.round)
    .sort((a, b) => b.round.startDate.localeCompare(a.round.startDate));

  return (
    <div className="profile">
      <Link to={`/g/${gameId}/players`} className="back-link">
        <Icon name="chevronLeft" size={16} /> Players
      </Link>
      <header className="profile-header">
        <Avatar id={player.id} name={player.name} size={72} />
        <div>
          <h2 className="display profile-name" dir="auto">
            {player.name}
          </h2>
          <div className="roster-tags">
            {player.isMe && <span className="you-tag">You</span>}
            {player.role === 'admin' && <Pill icon="crown">Admin</Pill>}
            {!player.hasAccount && <Pill>Guest</Pill>}
            {player.status === 'removed' && <Pill>Former player</Pill>}
          </div>
        </div>
        <div className="profile-points">
          <b>{stats.points}</b>
          <span>points</span>
        </div>
      </header>

      <section className="stat-tiles">
        <Tile value={percent(ratio(stats.done, stats.rounds))} label="Delivered" sub={`${stats.done} of ${plural(stats.rounds, 'round')}`} />
        <Tile value={stats.partial} label="Partly" sub={`${stats.failed} missed`} />
        <Tile value={percent(ratio(stats.callHits, stats.calls))} label="Excuse calls right" sub={`${stats.callHits} of ${stats.calls}`} />
        <Tile value={percent(ratio(stats.betHits, stats.bets))} label="Bets right" sub={`${stats.betHits} of ${stats.bets}`} />
        <Tile value={stats.doubted} label="Times doubted" sub={`backed ${plural(stats.backed, 'time')}`} />
        <Tile value={stats.streak || '—'} label="Current streak" sub="rounds in a row" />
      </section>

      {history.length > 0 && (
        <div className="form-strip" aria-label="Results, oldest to newest">
          {[...history].reverse().map(({ entry, round }) => (
            <Link key={round.id} to={round === lookup.current ? `/g/${gameId}` : `/g/${gameId}/rounds/${round.id}`}>
              <OutcomeDot outcome={round.status === 'planning' ? undefined : entry.outcome} title={`${shortDate(round.startDate)}: ${OUTCOME_LABEL[entry.outcome]}`} />
            </Link>
          ))}
        </div>
      )}

      <section className="section">
        <h3 className="section-title">Every round</h3>
        {history.length === 0 ? (
          <EmptyState title={`${player.name} hasn’t played a round yet.`} />
        ) : (
          <ol className="timeline">
            {history.map(({ entry, round }) => (
              <TimelineItem key={round.id} entry={entry} round={round} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Tile({ value, label, sub }: { value: ReactNode; label: string; sub: string }) {
  return (
    <div className="tile">
      <span className="tile-value">{value}</span>
      <span className="tile-label">{label}</span>
      <span className="tile-sub">{sub}</span>
    </div>
  );
}

function TimelineItem({ entry: e, round }: { entry: Entry; round: Round }) {
  const { lookup, gameId } = useGame();
  const roundEntries = lookup.entriesByRound.get(round.id) ?? [];
  const outcomes = outcomesByPlayer(roundEntries);
  const revealed = round.status !== 'planning';
  const doubters = revealed ? roundEntries.filter((x) => x.excusePickId === e.playerId) : [];
  const backers = revealed ? roundEntries.filter((x) => x.betPickId === e.playerId) : [];
  const verdict = (id: number | null, expected: 'done' | 'failed') => {
    const o = id != null ? outcomes.get(id) : undefined;
    return isResolved(o) ? o === expected : undefined;
  };

  return (
    <li className={`timeline-item outcome-${revealed ? e.outcome : 'none'}`}>
      <header className="timeline-head">
        <Link to={round === lookup.current ? `/g/${gameId}` : `/g/${gameId}/rounds/${round.id}`} className="timeline-date">
          {weekRange(round.startDate)}
        </Link>
        {revealed ? <OutcomePill outcome={e.outcome} /> : <Pill icon="clock">Planning</Pill>}
        {round.status === 'final' && <span className="muted small">{plural(entryPoints(e, outcomes), 'pt')}</span>}
      </header>
      <p className="timeline-goal" dir="auto">
        {e.goal || <span className="muted">No goal recorded</span>}
      </p>
      {e.excuse && (
        <blockquote className="timeline-excuse" dir="auto">
          {e.excuse}
        </blockquote>
      )}
      {e.notes && (
        <p className="timeline-notes">
          <span className="muted">Notes · </span>
          <span dir="auto">{e.notes}</span>
        </p>
      )}
      <dl className="facts">
        {!e.hidden && e.excusePickId != null && (
          <Fact label="Called excuses on" verdict={verdict(e.excusePickId, 'failed')}>
            <Who id={e.excusePickId} reason={e.excuseReason} />
          </Fact>
        )}
        {!e.hidden && e.betPickId != null && (
          <Fact label="Backed" verdict={verdict(e.betPickId, 'done')}>
            <Who id={e.betPickId} reason={e.betReason} />
          </Fact>
        )}
        {doubters.length > 0 && (
          <Fact label="Doubted by">
            {doubters.map((x) => (
              <Who key={x.playerId} id={x.playerId} reason={x.excuseReason} />
            ))}
          </Fact>
        )}
        {backers.length > 0 && (
          <Fact label="Backed by">
            {backers.map((x) => (
              <Who key={x.playerId} id={x.playerId} reason={x.betReason} />
            ))}
          </Fact>
        )}
      </dl>
    </li>
  );
}

function Fact({ label, verdict, children }: { label: string; verdict?: boolean; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>
        {label}
        {verdict !== undefined && (
          <span className={`verdict ${verdict ? 'is-right' : 'is-wrong'}`} title={verdict ? 'Called it' : 'Wrong call'}>
            <Icon name={verdict ? 'check' : 'x'} size={11} />
          </span>
        )}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function Who({ id, reason }: { id: number; reason: string }) {
  const { lookup, gameId } = useGame();
  return (
    <span className="who-line">
      <Link to={`/g/${gameId}/players/${id}`} className="who-name" dir="auto">
        {lookup.name(id)}
      </Link>
      {reason && (
        <>
          {' — '}
          <span dir="auto">{reason}</span>
        </>
      )}
    </span>
  );
}
