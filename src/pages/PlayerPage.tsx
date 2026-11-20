import { useMemo, type ReactNode } from 'react';
import { computeStats, entryPoints, isResolved, outcomesByPlayer, ratio } from '../../shared/scoring.ts';
import type { Entry, Round } from '../../shared/types.ts';
import { useI18n } from '../i18n.tsx';
import { GoalList } from '../goals.tsx';
import { ProofStrip } from '../proofs.tsx';
import { Link } from '../router.tsx';
import { useGame } from '../session.tsx';
import { Avatar, EmptyState, Icon, OutcomeDot, OutcomePill, Pill } from '../ui.tsx';

export function PlayerPage({ playerId }: { playerId: number }) {
  const { state, lookup, gameId } = useGame();
  const { t, fmt } = useI18n();
  const player = lookup.player.get(playerId);
  const finals = useMemo(() => lookup.rounds.filter((r) => r.status === 'final'), [lookup.rounds]);
  const stats = useMemo(
    () => computeStats(state.players, finals, state.entries).find((s) => s.playerId === playerId),
    [state, finals, playerId],
  );
  if (!player || !stats) return <EmptyState icon="x" title={t.profile.notFound} />;

  const history = (lookup.entriesByPlayer.get(playerId) ?? [])
    .map((entry) => ({ entry, round: lookup.round.get(entry.roundId)! }))
    .filter((x) => x.round)
    .sort((a, b) => b.round.startDate.localeCompare(a.round.startDate));

  return (
    <div className="profile">
      <Link to={`/g/${gameId}/players`} className="back-link">
        <Icon name="chevronLeft" size={16} /> {t.profile.back}
      </Link>
      <header className="profile-header">
        <Avatar id={player.id} name={player.name} size={72} />
        <div>
          <h2 className="display profile-name" dir="auto">
            {player.name}
          </h2>
          <div className="roster-tags">
            {player.isMe && <span className="you-tag">{t.common.you}</span>}
            {player.role === 'admin' && <Pill icon="crown">{t.common.admin}</Pill>}
            {!player.hasAccount && <Pill>{t.common.guest}</Pill>}
            {player.status === 'removed' && <Pill>{t.profile.former}</Pill>}
          </div>
        </div>
        <div className="profile-points">
          <b>{stats.points}</b>
          <span>{t.profile.points}</span>
        </div>
      </header>

      <section className="stat-tiles">
        <Tile value={fmt.percent(ratio(stats.done, stats.rounds))} label={t.profile.delivered} sub={t.profile.deliveredSub(stats.done, stats.rounds)} />
        <Tile value={stats.partial} label={t.profile.partly} sub={t.profile.missedSub(stats.failed)} />
        <Tile value={fmt.percent(ratio(stats.callHits, stats.calls))} label={t.profile.callsRight} sub={t.profile.ofSub(stats.callHits, stats.calls)} />
        <Tile value={fmt.percent(ratio(stats.betHits, stats.bets))} label={t.profile.betsRight} sub={t.profile.ofSub(stats.betHits, stats.bets)} />
        <Tile value={stats.doubted} label={t.profile.doubted} sub={t.profile.backedSub(stats.backed)} />
        <Tile value={stats.streak || '—'} label={t.profile.streak} sub={t.profile.streakSub} />
      </section>

      {history.length > 0 && (
        <div className="form-strip" aria-label={t.profile.historyLabel}>
          {[...history].reverse().map(({ entry, round }) => (
            <Link key={round.id} to={round === lookup.current ? `/g/${gameId}` : `/g/${gameId}/rounds/${round.id}`}>
              <OutcomeDot outcome={round.status === 'planning' ? undefined : entry.outcome} title={`${fmt.shortDate(round.startDate)}: ${t.outcome[entry.outcome]}`} />
            </Link>
          ))}
        </div>
      )}

      <section className="section">
        <h3 className="section-title">{t.profile.every}</h3>
        {history.length === 0 ? (
          <EmptyState title={t.profile.noRounds(player.name)} />
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
  const { t, fmt } = useI18n();
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
          {fmt.weekRange(round.startDate)}
        </Link>
        {revealed ? <OutcomePill outcome={e.outcome} /> : <Pill icon="clock">{t.phase.planning}</Pill>}
        {round.status === 'final' && <span className="muted small">{t.common.points(entryPoints(e, outcomes))}</span>}
      </header>
      {e.goals.length ? (
        <div className="timeline-goals">
          <GoalList goals={e.goals} showOutcomes={revealed} />
        </div>
      ) : (
        <p className="timeline-goal muted">{t.profile.noGoal}</p>
      )}
      {e.excuse && (
        <blockquote className="timeline-excuse">
          <span dir="auto">{e.excuse}</span>
        </blockquote>
      )}
      <ProofStrip entry={e} max={6} size="sm" />
      {e.notes && (
        <p className="timeline-notes">
          <span className="muted">{t.profile.notes} · </span>
          <span dir="auto">{e.notes}</span>
        </p>
      )}
      <dl className="facts">
        {!e.hidden && e.excusePickId != null && (
          <Fact label={t.profile.calledOn} verdict={verdict(e.excusePickId, 'failed')}>
            <Who id={e.excusePickId} reason={e.excuseReason} />
          </Fact>
        )}
        {!e.hidden && e.betPickId != null && (
          <Fact label={t.profile.backed} verdict={verdict(e.betPickId, 'done')}>
            <Who id={e.betPickId} reason={e.betReason} />
          </Fact>
        )}
        {doubters.length > 0 && (
          <Fact label={t.profile.doubtedBy}>
            {doubters.map((x) => (
              <Who key={x.playerId} id={x.playerId} reason={x.excuseReason} />
            ))}
          </Fact>
        )}
        {backers.length > 0 && (
          <Fact label={t.profile.backedBy}>
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
  const { t } = useI18n();
  return (
    <div className="fact">
      <dt>
        {label}
        {verdict !== undefined && (
          <span className={`verdict ${verdict ? 'is-right' : 'is-wrong'}`} title={verdict ? t.round.calledIt : t.round.wrongCall}>
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
