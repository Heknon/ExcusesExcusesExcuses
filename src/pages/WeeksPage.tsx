import { api } from '../api.ts';
import { EmptyState, OutcomeDot, PageHeader } from '../components.tsx';
import { addDays, OUTCOME_LABEL, plural, weekRange, weekStart } from '../format.ts';
import { Link, navigate } from '../router.tsx';
import { useStore, type Store } from '../store.ts';

/** Create a week starting this Sunday, or the first free Sunday after the latest week. */
export async function createNextWeek(store: Store) {
  const taken = new Set(store.state.weeks.map((w) => w.startDate));
  let start = weekStart();
  while (taken.has(start)) start = addDays(start, 7);
  const week = await store.mutate(() => api.addWeek({ startDate: start }));
  if (week) navigate(`/weeks/${week.id}`);
}

export function WeeksPage() {
  const store = useStore();
  const { lookup, state } = store;

  return (
    <>
      <PageHeader
        title="Weeks"
        actions={
          <>
            <Link to="/import" className="button">
              Import from WhatsApp
            </Link>
            <button className="button primary" disabled={!state.members.length} onClick={() => createNextWeek(store)}>
              New week
            </button>
          </>
        }
      />
      {lookup.weeks.length === 0 ? (
        <EmptyState title="No weeks yet">
          <p>
            Paste this week's message on the <Link to="/import">import page</Link>, or{' '}
            <Link to="/people">add people</Link> and start a new week.
          </p>
        </EmptyState>
      ) : (
        <ol className="list">
          {lookup.weeks.map((w) => {
            const entries = (lookup.entriesByWeek.get(w.id) ?? []).slice().sort((a, b) => a.memberId - b.memberId);
            const done = entries.filter((e) => e.outcome === 'done').length;
            const resolved = entries.filter((e) => e.outcome !== 'pending').length;
            return (
              <li key={w.id} className="list-row">
                <Link to={`/weeks/${w.id}`} className="list-row-link">
                  <div className="list-row-main">
                    <div className="list-row-title">
                      {weekRange(w.startDate)}
                      {!w.closed && <span className="status is-open">Open</span>}
                    </div>
                    {w.title && (
                      <div className="list-row-sub" dir="auto">
                        {w.title}
                      </div>
                    )}
                    {w.notes && (
                      <p className="list-row-notes" dir="auto">
                        {w.notes}
                      </p>
                    )}
                  </div>
                  <div className="list-row-side">
                    <div className="dots">
                      {entries.map((e) => (
                        <OutcomeDot
                          key={e.memberId}
                          outcome={e.outcome}
                          title={`${lookup.name(e.memberId)}: ${OUTCOME_LABEL[e.outcome]}`}
                        />
                      ))}
                    </div>
                    <div className="muted small">
                      {resolved ? `${done} of ${entries.length} done` : plural(entries.length, 'participant')}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
