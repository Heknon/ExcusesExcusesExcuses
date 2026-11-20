import { useMemo } from 'react';
import { search, type SearchField } from '../../shared/search.ts';
import { EmptyState, OutcomeBadge, PageHeader, PersonLink } from '../components.tsx';
import { weekRange } from '../format.ts';
import { Link } from '../router.tsx';
import { useStore } from '../store.ts';

const FIELD_LABEL: Record<SearchField, string> = {
  goal: 'Goal',
  excuse: 'Excuse',
  notes: 'Notes',
  excuseReason: 'Excuse call reason',
  betReason: 'Bet reason',
  weekTitle: 'Week title',
  weekNotes: 'Week notes',
};

export function SearchPage({ query }: { query: string }) {
  const { state, lookup } = useStore();
  const names = useMemo(() => new Map(state.members.map((m) => [m.id, m.name])), [state.members]);
  const hits = useMemo(() => search(state, query, names), [state, query, names]);

  return (
    <>
      <PageHeader
        title="Search"
        eyebrow={
          query.trim() ? (
            <>
              {hits.length} result{hits.length === 1 ? '' : 's'} for “<bdi>{query}</bdi>”
            </>
          ) : undefined
        }
      />
      {!query.trim() ? (
        <EmptyState title="Search every goal, excuse, reason and note">
          Use the search box at the top. Add a name to narrow it down, e.g. <code dir="auto">אלי ריצה</code>.
        </EmptyState>
      ) : hits.length === 0 ? (
        <EmptyState title="Nothing found" />
      ) : (
        <ol className="list results">
          {hits.map((h, i) => (
            <li key={i} className="list-row result">
              <div className="result-meta">
                <Link to={`/weeks/${h.week.id}`}>{weekRange(h.week.startDate)}</Link>
                {h.entry && <PersonLink member={lookup.member.get(h.entry.memberId)} />}
                <span className="muted">{FIELD_LABEL[h.field]}</span>
                {h.entry && h.field === 'goal' && <OutcomeBadge outcome={h.entry.outcome} />}
              </div>
              <p className="result-text" dir="auto">
                <Highlight text={h.text} query={query} />
              </p>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${terms.join('|')})`, 'gi'));
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}
    </>
  );
}
