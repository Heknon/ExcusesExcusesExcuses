import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isResolved } from '../../shared/scoring.ts';
import { search, type SearchField } from '../../shared/search.ts';
import { OUTCOME_LABEL, PHASE_LABEL, weekRange } from '../format.ts';
import { Link, navigate } from '../router.tsx';
import { useGame } from '../session.tsx';
import { Avatar, EmptyState, Icon, OutcomeDot, OutcomePill, Pill } from '../ui.tsx';

const FIELD_LABEL: Record<SearchField, string> = {
  goal: 'Goal',
  excuse: 'Excuse',
  notes: 'Notes',
  excuseReason: 'Why they’d have excuses',
  betReason: 'Why they’d deliver',
  roundTitle: 'Round title',
  roundNotes: 'Round notes',
};

export function HistoryPage({ query }: { query: string }) {
  const { gameId } = useGame();
  const [q, setQ] = useState(query);
  useEffect(() => setQ(query), [query]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate(`/g/${gameId}/history${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`, { replace: true, keepScroll: true });
  };

  return (
    <div className="history">
      <form className="search-bar" role="search" onSubmit={submit}>
        <Icon name="search" />
        <input
          className="search-input"
          type="search"
          dir="auto"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search every goal, excuse and note"
          aria-label="Search history"
        />
      </form>

      {query.trim() ? <SearchResults query={query} /> : <RoundList />}
    </div>
  );
}

function RoundList() {
  const { lookup, gameId } = useGame();
  if (!lookup.rounds.length) return <EmptyState icon="history" title="No rounds yet">Every round lands here, with goals, results, excuses and notes.</EmptyState>;

  return (
    <ol className="round-list">
      {lookup.rounds.map((r, i) => {
        const entries = (lookup.entriesByRound.get(r.id) ?? []).slice().sort((a, b) => a.playerId - b.playerId);
        const done = entries.filter((e) => e.outcome === 'done').length;
        const resolved = entries.filter((e) => isResolved(e.outcome)).length;
        return (
          <li key={r.id}>
            <Link to={i === 0 ? `/g/${gameId}` : `/g/${gameId}/rounds/${r.id}`} className="round-row">
              <span className="round-row-num">{lookup.rounds.length - i}</span>
              <span className="round-row-main">
                <span className="round-row-title">
                  {weekRange(r.startDate)}
                  {r.status !== 'final' && <Pill tone={r.status}>{PHASE_LABEL[r.status]}</Pill>}
                </span>
                {(r.title || r.notes) && (
                  <span className="round-row-notes" dir="auto">
                    {r.title || r.notes}
                  </span>
                )}
              </span>
              <span className="round-row-side">
                <span className="dots">
                  {entries.map((e) => (
                    <OutcomeDot key={e.playerId} outcome={r.status === 'planning' ? undefined : e.outcome} title={`${lookup.name(e.playerId)}: ${OUTCOME_LABEL[e.outcome]}`} />
                  ))}
                </span>
                <span className="muted small">{resolved ? `${done}/${entries.length} delivered` : `${entries.length} players`}</span>
              </span>
              <Icon name="chevronRight" className="round-row-chevron" />
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

function SearchResults({ query }: { query: string }) {
  const { state, lookup, gameId } = useGame();
  const names = useMemo(() => new Map(state.players.map((p) => [p.id, p.name])), [state.players]);
  const hits = useMemo(() => search(state, query, names), [state, query, names]);

  if (!hits.length) return <EmptyState icon="search" title="Nothing found">Try fewer words. Add a player’s name to narrow it down.</EmptyState>;

  return (
    <>
      <p className="muted small results-count">
        {hits.length} result{hits.length === 1 ? '' : 's'}
      </p>
      <ol className="search-results">
        {hits.map((h, i) => (
          <li key={i} className="search-hit">
            <div className="search-hit-meta">
              {h.entry && (
                <Link to={`/g/${gameId}/players/${h.entry.playerId}`} className="search-hit-who">
                  <Avatar id={h.entry.playerId} name={lookup.name(h.entry.playerId)} size={22} />
                  <span dir="auto">{lookup.name(h.entry.playerId)}</span>
                </Link>
              )}
              <span className="muted">{FIELD_LABEL[h.field]}</span>
              <Link to={h.round === lookup.current ? `/g/${gameId}` : `/g/${gameId}/rounds/${h.round.id}`} className="muted">
                {weekRange(h.round.startDate)}
              </Link>
              {h.entry && h.field === 'goal' && h.round.status !== 'planning' && <OutcomePill outcome={h.entry.outcome} />}
            </div>
            <p className="search-hit-text" dir="auto">
              <Highlight text={h.text} query={query} />
            </p>
          </li>
        ))}
      </ol>
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
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}
