import { useMemo, type ReactNode } from 'react';
import { computeStats, ratio } from '../../shared/scoring.ts';
import type { Entry, Week } from '../../shared/types.ts';
import { api } from '../api.ts';
import { EditableText, EmptyState, OutcomeBadge, OutcomeDot, PageHeader, PersonLink, Stat } from '../components.tsx';
import { OUTCOME_LABEL, percent, shortDate, weekRange } from '../format.ts';
import { Link, navigate } from '../router.tsx';
import { useStore } from '../store.ts';

export function PersonPage({ id }: { id: number }) {
  const { state, lookup, mutate } = useStore();
  const member = lookup.member.get(id);
  const stats = useMemo(() => computeStats(state).find((s) => s.memberId === id), [state, id]);
  if (!member || !stats) return <EmptyState title="Person not found" />;

  const history = (lookup.entriesByMember.get(id) ?? [])
    .map((entry) => ({ entry, week: lookup.week.get(entry.weekId)! }))
    .filter((x) => x.week)
    .sort((a, b) => b.week.startDate.localeCompare(a.week.startDate));
  const chronological = [...history].reverse();

  const remove = async () => {
    if (!confirm(`Delete ${member.name} and their entire history? Consider marking them inactive instead.`)) return;
    await mutate(() => api.deleteMember(member.id));
    navigate('/people', { replace: true });
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link to="/people">People</Link>}
        title={
          <EditableText
            className="title-input"
            label="Name"
            value={member.name}
            onSave={(name) => name && mutate(() => api.updateMember(member.id, { name }))}
          />
        }
        actions={
          <button className="button" onClick={() => mutate(() => api.updateMember(member.id, { active: !member.active }))}>
            {member.active ? 'Mark inactive' : 'Mark active'}
          </button>
        }
      >
        {!member.active && <p className="muted">Inactive — not added to new weeks.</p>}
      </PageHeader>

      <section className="stats">
        <Stat label="Weeks" value={stats.weeks} hint="Weeks with a recorded outcome" />
        <Stat label="Done" value={stats.done} />
        <Stat label="Partial" value={stats.partial} />
        <Stat label="Missed" value={stats.failed} />
        <Stat label="Completion" value={percent(ratio(stats.done, stats.weeks))} />
        <Stat
          label="Excuse calls right"
          value={percent(ratio(stats.callHits, stats.calls))}
          hint={`${stats.callHits} of ${stats.calls}`}
        />
        <Stat label="Bets right" value={percent(ratio(stats.betHits, stats.bets))} hint={`${stats.betHits} of ${stats.bets}`} />
        <Stat label="Times doubted" value={stats.doubted} />
        <Stat label="Times backed" value={stats.backed} />
      </section>

      {chronological.length > 0 && (
        <div className="strip" aria-label="Outcome history, oldest to newest">
          {chronological.map(({ entry, week }) => (
            <OutcomeDot
              key={week.id}
              outcome={entry.outcome}
              to={`/weeks/${week.id}`}
              title={`${shortDate(week.startDate)}: ${OUTCOME_LABEL[entry.outcome]}`}
            />
          ))}
        </div>
      )}

      <section className="section">
        <h2 className="section-title">History</h2>
        {history.length === 0 ? (
          <EmptyState title={`${member.name} hasn't been in any weeks yet.`} />
        ) : (
          <ol className="timeline">
            {history.map(({ entry, week }) => (
              <TimelineItem key={week.id} entry={entry} week={week} />
            ))}
          </ol>
        )}
      </section>

      <footer className="danger-zone">
        <button className="button-link danger" onClick={remove}>
          Delete {member.name}
        </button>
      </footer>
    </>
  );
}

function TimelineItem({ entry: e, week }: { entry: Entry; week: Week }) {
  const { lookup } = useStore();
  const weekEntries = lookup.entriesByWeek.get(week.id) ?? [];
  const outcomeOf = (memberId: number | null) => weekEntries.find((x) => x.memberId === memberId)?.outcome;
  const doubters = weekEntries.filter((x) => x.excusePickId === e.memberId);
  const backers = weekEntries.filter((x) => x.betPickId === e.memberId);

  return (
    <li className="timeline-item">
      <header className="timeline-header">
        <Link to={`/weeks/${week.id}`} className="timeline-week">
          {weekRange(week.startDate)}
        </Link>
        <OutcomeBadge outcome={e.outcome} />
      </header>

      <p className="timeline-goal" dir="auto">
        {e.goal || <span className="muted">No goal recorded</span>}
      </p>

      <dl className="facts">
        {e.excuse && (
          <Fact label="Excuse">
            <span dir="auto">{e.excuse}</span>
          </Fact>
        )}
        {e.notes && (
          <Fact label="Notes">
            <span dir="auto">{e.notes}</span>
          </Fact>
        )}
        {e.excusePickId != null && (
          <Fact label="Called excuses on" verdict={verdict(outcomeOf(e.excusePickId), 'failed')}>
            <PersonLink member={lookup.member.get(e.excusePickId)} />
            {e.excuseReason && <> — <span dir="auto">{e.excuseReason}</span></>}
          </Fact>
        )}
        {e.betPickId != null && (
          <Fact label="Bet on" verdict={verdict(outcomeOf(e.betPickId), 'done')}>
            <PersonLink member={lookup.member.get(e.betPickId)} />
            {e.betReason && <> — <span dir="auto">{e.betReason}</span></>}
          </Fact>
        )}
        {doubters.length > 0 && (
          <Fact label="Doubted by">
            <Opinions entries={doubters} reason={(x) => x.excuseReason} />
          </Fact>
        )}
        {backers.length > 0 && (
          <Fact label="Backed by">
            <Opinions entries={backers} reason={(x) => x.betReason} />
          </Fact>
        )}
      </dl>
    </li>
  );
}

function verdict(outcome: Entry['outcome'] | undefined, expected: 'done' | 'failed') {
  if (!outcome || outcome === 'pending') return undefined;
  return outcome === expected;
}

function Fact({ label, verdict, children }: { label: string; verdict?: boolean; children: ReactNode }) {
  return (
    <div className="fact">
      <dt>
        {label}
        {verdict !== undefined && <span className={`verdict ${verdict ? 'is-right' : 'is-wrong'}`}>{verdict ? 'Right' : 'Wrong'}</span>}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function Opinions({ entries, reason }: { entries: Entry[]; reason: (e: Entry) => string }) {
  const { lookup } = useStore();
  return (
    <ul className="opinions">
      {entries.map((x) => (
        <li key={x.memberId}>
          <PersonLink member={lookup.member.get(x.memberId)} />
          {reason(x) && <> — <span dir="auto">{reason(x)}</span></>}
        </li>
      ))}
    </ul>
  );
}
