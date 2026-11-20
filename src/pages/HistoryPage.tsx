import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { isResolved } from '../../shared/scoring.ts';
import { search } from '../../shared/search.ts';
import { useI18n } from '../i18n.tsx';
import { Link, navigate } from '../router.tsx';
import { useGame } from '../session.tsx';
import { Avatar, EmptyState, Icon, OutcomeDot, OutcomePill, Pill } from '../ui.tsx';

export function HistoryPage({ query }: { query: string }) {
  const { gameId } = useGame();
  const { t } = useI18n();
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
          placeholder={t.history.search}
          aria-label={t.history.searchLabel}
        />
      </form>

      {query.trim() ? <SearchResults query={query} /> : <RoundList />}
    </div>
  );
}

function RoundList() {
  const { lookup, gameId } = useGame();
  const { t, fmt } = useI18n();
  if (!lookup.rounds.length) {
    return (
      <EmptyState icon="history" title={t.history.emptyTitle}>
        {t.history.emptyBody}
      </EmptyState>
    );
  }

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
                  {fmt.weekRange(r.startDate)}
                  {r.status !== 'final' && <Pill tone={r.status}>{t.phase[r.status]}</Pill>}
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
                    <OutcomeDot key={e.playerId} outcome={r.status === 'planning' ? undefined : e.outcome} title={`${lookup.name(e.playerId)}: ${t.outcome[e.outcome]}`} />
                  ))}
                </span>
                <span className="muted small">{resolved ? t.history.deliveredOf(done, entries.length) : t.common.players(entries.length)}</span>
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
  const { t, fmt } = useI18n();
  const names = useMemo(() => new Map(state.players.map((p) => [p.id, p.name])), [state.players]);
  const hits = useMemo(() => search(state, query, names), [state, query, names]);

  if (!hits.length) {
    return (
      <EmptyState icon="search" title={t.history.nothingTitle}>
        {t.history.nothingBody}
      </EmptyState>
    );
  }

  return (
    <>
      <p className="muted small results-count">{t.history.results(hits.length)}</p>
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
              <span className="muted">{t.history.field[h.field]}</span>
              <Link to={h.round === lookup.current ? `/g/${gameId}` : `/g/${gameId}/rounds/${h.round.id}`} className="muted">
                {fmt.weekRange(h.round.startDate)}
              </Link>
              {h.goal && h.round.status !== 'planning' && <OutcomePill outcome={h.goal.outcome} />}
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
