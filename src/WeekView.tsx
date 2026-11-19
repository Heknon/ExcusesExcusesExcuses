import { useMemo, useState } from 'react';
import type { Entry, Member, Week } from '../shared/types.ts';
import { weekPoints } from '../shared/scoring.ts';
import { formatRound } from '../shared/whatsapp.ts';
import { api } from './api.ts';
import type { Store } from './store.ts';
import { Avatar, EditableText, Empty, MemberSelect, OUTCOME_META, OutcomePicker, formatDate } from './ui.tsx';

type Tab = 'goals' | 'excuses' | 'bets' | 'results';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'goals', label: 'ביצועים', hint: 'מה כל אחד מתחייב לעשות השבוע' },
  { id: 'excuses', label: 'תירוצים', hint: 'מי יחזור עם תירוצים, ולמה' },
  { id: 'bets', label: 'הימורים', hint: 'מי בטוח יבצע' },
  { id: 'results', label: 'תוצאות', hint: 'סוף שבוע – מי ביצע ומי הביא תירוץ' },
];

export function WeekView({ store, week, onDeleted }: { store: Store; week: Week; onDeleted: () => void }) {
  const { state, run, patchEntry } = store;
  const [tab, setTab] = useState<Tab>(week.closed ? 'results' : 'goals');
  const [copied, setCopied] = useState(false);

  const memberById = useMemo(() => new Map(state.members.map((m) => [m.id, m])), [state.members]);
  const entries = state.entries
    .filter((e) => e.weekId === week.id && memberById.has(e.memberId))
    .sort((a, b) => a.memberId - b.memberId);
  const inWeek = entries.map((e) => memberById.get(e.memberId)!);
  const notInWeek = state.members.filter((m) => m.active && !entries.some((e) => e.memberId === m.id));
  const outcomes = new Map(entries.map((e) => [e.memberId, e.outcome]));
  const locked = week.closed;
  const name = (id: number | null) => (id == null ? null : memberById.get(id)?.name ?? null);

  const tally = (key: 'excusePickId' | 'betPickId') => {
    const counts = new Map<number, number>();
    for (const e of entries) if (e[key] != null) counts.set(e[key]!, (counts.get(e[key]!) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  };

  const copyWhatsApp = async () => {
    const text = formatRound(
      entries.map((e) => ({
        name: memberById.get(e.memberId)!.name,
        goal: e.goal,
        excuseTarget: name(e.excusePickId),
        excuseReason: e.excuseReason,
        betTarget: name(e.betPickId),
        betReason: e.betReason,
      })),
    );
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt('העתיקו את הטקסט:', text);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const progress = {
    goals: entries.filter((e) => e.goal).length,
    excuses: entries.filter((e) => e.excusePickId != null).length,
    bets: entries.filter((e) => e.betPickId != null).length,
    results: entries.filter((e) => e.outcome !== 'pending').length,
  };

  return (
    <section className="week">
      <header className="week-head">
        <div className="week-title">
          <EditableText
            className="title-input"
            value={week.title}
            placeholder={`שבוע ${formatDate(week.startDate)}`}
            ariaLabel="שם השבוע"
            onSave={(title) => run(() => api.updateWeek(week.id, { title }))}
          />
          <div className="week-meta">
            <input
              type="date"
              className="field date"
              value={week.startDate}
              aria-label="תאריך תחילת השבוע"
              onChange={(e) => e.target.value && run(() => api.updateWeek(week.id, { startDate: e.target.value }))}
            />
            {locked ? <span className="badge closed">🔒 סגור</span> : <span className="badge open">פתוח</span>}
          </div>
        </div>
        <div className="week-actions">
          <button className="btn ghost" onClick={copyWhatsApp}>
            {copied ? '✓ הועתק' : '📋 העתק לוואטסאפ'}
          </button>
          <button className="btn ghost" onClick={() => run(() => api.updateWeek(week.id, { closed: !locked }))}>
            {locked ? 'פתח מחדש' : '🏁 סגור שבוע'}
          </button>
          <button
            className="btn ghost danger"
            onClick={() => {
              if (confirm('למחוק את השבוע הזה? אין דרך חזרה.')) run(() => api.deleteWeek(week.id)).then(onDeleted);
            }}
          >
            מחק
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab tab-${t.id} ${tab === t.id ? 'on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            <span className="count">
              {progress[t.id]}/{entries.length}
            </span>
          </button>
        ))}
      </nav>
      <p className="hint">{TABS.find((t) => t.id === tab)!.hint}</p>

      {entries.length === 0 && <Empty>אין משתתפים בשבוע הזה. הוסיפו חברים מלמטה.</Empty>}

      {(tab === 'excuses' || tab === 'bets') && entries.length > 0 && (
        <Tally
          kind={tab}
          rows={tally(tab === 'excuses' ? 'excusePickId' : 'betPickId').map(([id, n]) => [name(id) ?? '?', n])}
        />
      )}

      <ul className={`rows rows-${tab}`}>
        {entries.map((e) => {
          const m = memberById.get(e.memberId)!;
          const patch = (p: Partial<Entry>) => patchEntry(week.id, m.id, p);
          return (
            <li key={m.id} className={`row outcome-bg-${tab === 'results' ? e.outcome : 'none'}`}>
              <div className="who">
                <Avatar name={m.name} />
                <span className="who-name">{m.name}</span>
              </div>
              <div className="what">
                {tab === 'goals' && (
                  <EditableText
                    multiline
                    value={e.goal}
                    disabled={locked}
                    placeholder="מה המשימה השבוע?"
                    onSave={(goal) => patch({ goal })}
                  />
                )}
                {(tab === 'excuses' || tab === 'bets') && (
                  <PickEditor
                    members={inWeek}
                    self={m.id}
                    disabled={locked}
                    pickId={tab === 'excuses' ? e.excusePickId : e.betPickId}
                    reason={tab === 'excuses' ? e.excuseReason : e.betReason}
                    placeholder={tab === 'excuses' ? 'מי יביא תירוצים?' : 'על מי מהמרים?'}
                    onPick={(id) => patch(tab === 'excuses' ? { excusePickId: id } : { betPickId: id })}
                    onReason={(r) => patch(tab === 'excuses' ? { excuseReason: r } : { betReason: r })}
                  />
                )}
                {tab === 'results' && (
                  <ResultEditor
                    entry={e}
                    entries={entries}
                    nameOf={name}
                    points={weekPoints(e, outcomes)}
                    locked={locked}
                    onPatch={patch}
                  />
                )}
              </div>
              {!locked && tab === 'goals' && (
                <button
                  className="icon-btn"
                  title={`הוצא את ${m.name} מהשבוע`}
                  aria-label={`הוצא את ${m.name} מהשבוע`}
                  onClick={() => run(() => api.removeEntry(week.id, m.id))}
                >
                  ×
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {!locked && notInWeek.length > 0 && (
        <div className="add-to-week">
          <span>להוסיף לשבוע:</span>
          {notInWeek.map((m) => (
            <button key={m.id} className="chip" onClick={() => patchEntry(week.id, m.id, {})}>
              + {m.name}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function Tally({ kind, rows }: { kind: 'excuses' | 'bets'; rows: [string, number][] }) {
  if (!rows.length) return null;
  const max = rows[0][1];
  return (
    <div className={`tally tally-${kind}`}>
      <span className="tally-label">{kind === 'excuses' ? 'הכי מפוקפקים' : 'הכי מגובים'}</span>
      {rows.map(([n, c]) => (
        <span key={n} className={`tally-chip ${c === max ? 'top' : ''}`}>
          {n} <b>×{c}</b>
        </span>
      ))}
    </div>
  );
}

function PickEditor(props: {
  members: Member[];
  self: number;
  pickId: number | null;
  reason: string;
  placeholder: string;
  disabled: boolean;
  onPick: (id: number | null) => void;
  onReason: (r: string) => void;
}) {
  return (
    <div className="pick">
      <MemberSelect
        members={props.members}
        exclude={props.self}
        value={props.pickId}
        disabled={props.disabled}
        placeholder={props.placeholder}
        onChange={props.onPick}
      />
      <EditableText
        multiline
        className="reason"
        value={props.reason}
        disabled={props.disabled}
        placeholder="כי…"
        ariaLabel="סיבה"
        onSave={props.onReason}
      />
    </div>
  );
}

function ResultEditor(props: {
  entry: Entry;
  entries: Entry[];
  nameOf: (id: number | null) => string | null;
  points: number;
  locked: boolean;
  onPatch: (p: Partial<Entry>) => void;
}) {
  const { entry: e, entries, nameOf } = props;
  const doubters = entries.filter((x) => x.excusePickId === e.memberId).map((x) => nameOf(x.memberId));
  const backers = entries.filter((x) => x.betPickId === e.memberId).map((x) => nameOf(x.memberId));
  return (
    <div className="result">
      <p className="goal-read">{e.goal || <em className="muted">לא הוגדרה משימה</em>}</p>
      <OutcomePicker value={e.outcome} disabled={props.locked} onChange={(outcome) => props.onPatch({ outcome })} />
      {(e.outcome === 'failed' || e.outcome === 'partial') && (
        <EditableText
          multiline
          className="excuse-input"
          value={e.excuse}
          disabled={props.locked}
          placeholder="נו, מה התירוץ? 🙃"
          ariaLabel="התירוץ"
          onSave={(excuse) => props.onPatch({ excuse })}
        />
      )}
      <div className="result-meta">
        {doubters.length > 0 && (
          <span className={`meta-chip ${e.outcome === 'failed' ? 'hit' : ''}`}>🙄 פקפקו: {doubters.join(', ')}</span>
        )}
        {backers.length > 0 && (
          <span className={`meta-chip ${e.outcome === 'done' ? 'hit' : ''}`}>🎯 גיבו: {backers.join(', ')}</span>
        )}
        {e.outcome !== 'pending' && (
          <span className="meta-chip points">
            {OUTCOME_META[e.outcome].icon} {props.points} נק׳ השבוע
          </span>
        )}
      </div>
    </div>
  );
}
