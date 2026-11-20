import { useMemo } from 'react';
import { computeStats, POINTS, ratio } from '../../shared/scoring.ts';
import { OUTCOME_LABEL, percent, shortDate } from '../format.ts';
import { Link } from '../router.tsx';
import { useGame } from '../session.tsx';
import { Avatar, EmptyState, OutcomeDot } from '../ui.tsx';

const FORM_ROUNDS = 6;

export function StandingsPage() {
  const { state, lookup, gameId } = useGame();
  // Only scored rounds count toward standings.
  const finals = useMemo(() => lookup.rounds.filter((r) => r.status === 'final'), [lookup.rounds]);
  const stats = useMemo(
    () => computeStats(state.players, finals, state.entries).filter((s) => s.rounds > 0),
    [state.players, state.entries, finals],
  );

  if (!stats.length) {
    return (
      <EmptyState icon="trophy" title="No scored rounds yet">
        Standings start once the first round is scored.
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
                      return <OutcomeDot key={r.id} outcome={e?.outcome} title={`${shortDate(r.startDate)}: ${e ? OUTCOME_LABEL[e.outcome] : 'Sat out'}`} />;
                    })}
                  </span>
                </span>
              </Link>
              <span className="leader-stat">
                <b>{percent(completion)}</b>
                <span>delivered</span>
              </span>
              <span className="leader-stat">
                <b>{percent(calls)}</b>
                <span>reads right</span>
              </span>
              <span className="leader-stat">
                <b>{s.streak || '—'}</b>
                <span>streak</span>
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
        <h3 className="section-title">Round by round</h3>
        <div className="table-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                <th />
                {grid.map((r) => (
                  <th key={r.id}>
                    <Link to={r === lookup.current ? `/g/${gameId}` : `/g/${gameId}/rounds/${r.id}`}>{shortDate(r.startDate)}</Link>
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
                        <OutcomeDot outcome={e?.outcome} title={`${shortDate(r.startDate)}: ${e ? OUTCOME_LABEL[e.outcome] : 'Sat out'}`} />
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
        <h3 className="section-title">How scoring works</h3>
        <ul className="scoring-list">
          <li>
            <b>+{POINTS.done}</b> goal done
          </li>
          <li>
            <b>+{POINTS.partial}</b> partly done
          </li>
          <li>
            <b>+{POINTS.callHit}</b> you called excuses on someone and they missed
          </li>
          <li>
            <b>+{POINTS.betHit}</b> you backed someone and they delivered
          </li>
        </ul>
        <p className="muted small">“Reads right” is how often your excuse calls and bets were correct. Only scored rounds count.</p>
      </section>
    </div>
  );
}
