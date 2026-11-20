import { useMemo } from 'react';
import { computeStats, POINTS, ratio } from '../../shared/scoring.ts';
import { EmptyState, OutcomeDot, PageHeader, PersonLink } from '../components.tsx';
import { OUTCOME_LABEL, percent, shortDate } from '../format.ts';
import { Link } from '../router.tsx';
import { useStore } from '../store.ts';

export function StandingsPage() {
  const { state, lookup } = useStore();
  const stats = useMemo(() => computeStats(state).filter((s) => s.weeks > 0), [state]);
  const weeks = [...lookup.weeks].reverse();

  if (!stats.length) {
    return (
      <>
        <PageHeader title="Standings" />
        <EmptyState title="No results yet">Standings fill in once outcomes are recorded on a week.</EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Standings" />

      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Name</th>
              <th className="num">Points</th>
              <th className="num">Done</th>
              <th className="num">Partial</th>
              <th className="num">Missed</th>
              <th className="num">Completion</th>
              <th className="num" title="Called excuses on someone who then missed">Excuse calls</th>
              <th className="num" title="Bet on someone who then delivered">Bets</th>
              <th className="num" title="Consecutive weeks done, most recent first">Streak</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => (
              <tr key={s.memberId}>
                <td className="num muted">{i + 1}</td>
                <td>
                  <PersonLink member={lookup.member.get(s.memberId)} />
                </td>
                <td className="num strong">{s.points}</td>
                <td className="num">{s.done}</td>
                <td className="num">{s.partial}</td>
                <td className="num">{s.failed}</td>
                <td className="num">{percent(ratio(s.done, s.weeks))}</td>
                <td className="num">
                  {s.callHits}/{s.calls}
                </td>
                <td className="num">
                  {s.betHits}/{s.bets}
                </td>
                <td className="num">{s.streak || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="section">
        <h2 className="section-title">By week</h2>
        <div className="table-scroll">
          <table className="table grid">
            <thead>
              <tr>
                <th>Name</th>
                {weeks.map((w) => (
                  <th key={w.id} className="grid-col">
                    <Link to={`/weeks/${w.id}`}>{shortDate(w.startDate)}</Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.map((s) => (
                <tr key={s.memberId}>
                  <td>
                    <PersonLink member={lookup.member.get(s.memberId)} />
                  </td>
                  {weeks.map((w) => {
                    const e = lookup.entriesByWeek.get(w.id)?.find((x) => x.memberId === s.memberId);
                    return (
                      <td key={w.id} className="grid-col">
                        <OutcomeDot
                          outcome={e?.outcome}
                          title={`${shortDate(w.startDate)}: ${e ? OUTCOME_LABEL[e.outcome] : 'Not in this week'}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Scoring</h2>
        <table className="table compact">
          <tbody>
            <tr><td>Goal done</td><td className="num">{POINTS.done}</td></tr>
            <tr><td>Goal partially done</td><td className="num">{POINTS.partial}</td></tr>
            <tr><td>Goal missed</td><td className="num">{POINTS.failed}</td></tr>
            <tr><td>Called excuses on someone who missed</td><td className="num">+{POINTS.callHit}</td></tr>
            <tr><td>Bet on someone who got it done</td><td className="num">+{POINTS.betHit}</td></tr>
          </tbody>
        </table>
        <p className="muted small">Only weeks with a recorded outcome count.</p>
      </section>
    </>
  );
}
