import { useMemo, useState, type FormEvent } from 'react';
import { computeStats, ratio } from '../../shared/scoring.ts';
import { api } from '../api.ts';
import { EmptyState, OutcomeDot, PageHeader } from '../components.tsx';
import { OUTCOME_LABEL, percent, shortDate } from '../format.ts';
import { Link } from '../router.tsx';
import { useStore } from '../store.ts';

const HISTORY_WEEKS = 12;

export function PeoplePage() {
  const { state, lookup, mutate } = useStore();
  const [name, setName] = useState('');
  const stats = useMemo(() => new Map(computeStats(state).map((s) => [s.memberId, s])), [state]);

  const recentWeeks = lookup.weeks.slice(0, HISTORY_WEEKS).reverse();
  const members = [...state.members].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'he'));

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    mutate(() => api.addMember(name.trim()));
    setName('');
  };

  return (
    <>
      <PageHeader title="People" />
      {members.length === 0 ? (
        <EmptyState title="No people yet">Add the team below, or import a WhatsApp message.</EmptyState>
      ) : (
        <ol className="list">
          {members.map((m) => {
            const s = stats.get(m.id)!;
            const entries = lookup.entriesByMember.get(m.id) ?? [];
            const latest = entries
              .map((e) => ({ e, w: lookup.week.get(e.weekId)! }))
              .filter((x) => x.w && x.e.goal)
              .sort((a, b) => b.w.startDate.localeCompare(a.w.startDate))[0];
            return (
              <li key={m.id} className={`list-row ${m.active ? '' : 'is-inactive'}`}>
                <Link to={`/people/${m.id}`} className="list-row-link">
                  <div className="list-row-main">
                    <div className="list-row-title" dir="auto">
                      {m.name}
                      {!m.active && <span className="status is-closed">Inactive</span>}
                    </div>
                    {latest && (
                      <div className="list-row-sub">
                        <span className="muted">Latest: </span>
                        <span dir="auto">{latest.e.goal}</span>
                      </div>
                    )}
                  </div>
                  <div className="list-row-side">
                    <div className="dots">
                      {recentWeeks.map((w) => {
                        const e = entries.find((x) => x.weekId === w.id);
                        return (
                          <OutcomeDot
                            key={w.id}
                            outcome={e?.outcome}
                            title={`${shortDate(w.startDate)}: ${e ? OUTCOME_LABEL[e.outcome] : 'Not in this week'}`}
                          />
                        );
                      })}
                    </div>
                    <div className="muted small">
                      {s.weeks ? `${percent(ratio(s.done, s.weeks))} done over ${s.weeks} wk` : 'No results yet'}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <form className="inline-form" onSubmit={add}>
        <label htmlFor="new-person">Add a person</label>
        <input id="new-person" className="input" dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <button className="button" type="submit" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </>
  );
}
