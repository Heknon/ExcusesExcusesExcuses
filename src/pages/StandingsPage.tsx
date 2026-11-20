import { useMemo } from 'react';
import { computeStats, POINTS, ratio } from '../../shared/scoring.ts';
import { useI18n } from '../i18n.tsx';
import { Link } from '../router.tsx';
import { useGame } from '../session.tsx';
import { Avatar, EmptyState, OutcomeDot } from '../ui.tsx';

const FORM_ROUNDS = 6;

export function StandingsPage() {
  const { state, lookup, gameId } = useGame();
  const { t, fmt } = useI18n();
  // Only scored rounds count toward standings.
  const finals = useMemo(() => lookup.rounds.filter((r) => r.status === 'final'), [lookup.rounds]);
  const stats = useMemo(
    () => computeStats(state.players, finals, state.entries).filter((s) => s.rounds > 0),
    [state.players, state.entries, finals],
  );

  if (!stats.length) {
    return (
      <EmptyState icon="trophy" title={t.standings.emptyTitle}>
        {t.standings.emptyBody}
      </EmptyState>
    );
  }

  const leader = stats[0].points;
  const formRounds = finals.slice(0, FORM_ROUNDS).reverse();
  const grid = [...finals].reverse();

  return (
    <div className="standings">
      <ol className="leaderboard">
        {stats.map((s) => {
          // Ties share a rank: 1, 2, 2, 4.
          const rank = stats.findIndex((x) => x.points === s.points) + 1;
          const completion = ratio(s.done, s.rounds);
          const calls = ratio(s.callHits + s.betHits, s.calls + s.bets);
          return (
            <li key={s.playerId} className={`leader-row ${s.points === leader ? 'is-first' : ''}`}>
              <span className="leader-rank">{rank}</span>
              <Link to={`/g/${gameId}/players/${s.playerId}`} className="leader-who">
                <Avatar id={s.playerId} name={lookup.name(s.playerId)} size={40} />
                <span>
                  <span className="leader-name" dir="auto">
                    {lookup.name(s.playerId)}
                  </span>
                  <span className="leader-form">
                    {formRounds.map((r) => {
                      const e = lookup.entriesByRound.get(r.id)?.find((x) => x.playerId === s.playerId);
                      return <OutcomeDot key={r.id} outcome={e?.outcome} title={`${fmt.shortDate(r.startDate)}: ${e ? t.outcome[e.outcome] : t.standings.satOut}`} />;
                    })}
                  </span>
                </span>
              </Link>
              <span className="leader-stat">
                <b>{fmt.percent(completion)}</b>
                <span>{t.standings.delivered}</span>
              </span>
              <span className="leader-stat">
                <b>{fmt.percent(calls)}</b>
                <span>{t.standings.readsRight}</span>
              </span>
              <span className="leader-stat">
                <b>{s.mvps || '—'}</b>
                <span>{t.standings.mvps}</span>
              </span>
              <span className="leader-points">
                <b>{s.points}</b>
                <span className="leader-bar">
                  <span style={{ width: `${leader ? (s.points / leader) * 100 : 0}%` }} />
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      <section className="section">
        <h3 className="section-title">{t.standings.byRound}</h3>
        <div className="table-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                <th />
                {grid.map((r) => (
                  <th key={r.id}>
                    <Link to={r === lookup.current ? `/g/${gameId}` : `/g/${gameId}/rounds/${r.id}`}>{fmt.shortDate(r.startDate)}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.playerId}>
                  <th scope="row">
                    <bdi>{lookup.name(s.playerId)}</bdi>
                  </th>
                  {grid.map((r) => {
                    const e = lookup.entriesByRound.get(r.id)?.find((x) => x.playerId === s.playerId);
                    return (
                      <td key={r.id}>
                        <OutcomeDot outcome={e?.outcome} title={`${fmt.shortDate(r.startDate)}: ${e ? t.outcome[e.outcome] : t.standings.satOut}`} />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section scoring">
        <h3 className="section-title">{t.standings.how}</h3>
        <ul className="scoring-list">
          <li>
            <b dir="ltr">+{POINTS.done}</b> {t.standings.rules.done}
          </li>
          <li>
            <b dir="ltr">+{POINTS.partial}</b> {t.standings.rules.partial}
          </li>
          <li>
            <b dir="ltr">+{POINTS.callHit}</b> {t.standings.rules.call}
          </li>
          <li>
            <b dir="ltr">+{POINTS.betHit}</b> {t.standings.rules.bet}
          </li>
          <li>
            <b dir="ltr">+{POINTS.mvp}</b> {t.standings.rules.mvp}
          </li>
        </ul>
        <p className="muted small">{t.standings.footnote}</p>
      </section>
    </div>
  );
}
