import { useState, type ReactNode } from 'react';
import { entryPoints, outcomesByMember } from '../../shared/scoring.ts';
import type { Entry, EntryPatch, Member, Week } from '../../shared/types.ts';
import { formatRound } from '../../shared/whatsapp.ts';
import { api } from '../api.ts';
import {
  EditableText,
  EmptyState,
  MemberSelect,
  OutcomeBadge,
  OutcomeControl,
  PageHeader,
  PersonLink,
} from '../components.tsx';
import { OUTCOME_LABEL, plural, weekLabel, weekRange } from '../format.ts';
import { Link, navigate } from '../router.tsx';
import { useStore } from '../store.ts';

export function WeekPage({ id }: { id: number }) {
  const { lookup, mutate, patchWeek, patchEntry } = useStore();
  const week = lookup.week.get(id);
  if (!week) return <EmptyState title="Week not found" />;

  const entries = (lookup.entriesByWeek.get(id) ?? []).slice().sort((a, b) => a.memberId - b.memberId);
  const participants = entries.map((e) => lookup.member.get(e.memberId)!);
  const others = [...lookup.member.values()].filter((m) => m.active && !participants.includes(m));
  const index = lookup.weeks.indexOf(week);
  const newer = lookup.weeks[index - 1];
  const older = lookup.weeks[index + 1];

  const remove = async () => {
    if (!confirm(`Delete ${weekLabel(week)}? This removes every entry in it.`)) return;
    await mutate(() => api.deleteWeek(week.id));
    navigate('/weeks', { replace: true });
  };

  return (
    <article className="week">
      <PageHeader
        eyebrow={
          <span className="week-nav">
            {older ? <Link to={`/weeks/${older.id}`}>← Older</Link> : <span className="muted">← Older</span>}
            <span className={`status ${week.closed ? 'is-closed' : 'is-open'}`}>{week.closed ? 'Closed' : 'Open'}</span>
            {newer ? <Link to={`/weeks/${newer.id}`}>Newer →</Link> : <span className="muted">Newer →</span>}
          </span>
        }
        title={weekRange(week.startDate)}
        actions={
          <>
            <CopyMessageButton week={week} entries={entries} />
            <button className="button" onClick={() => patchWeek(week.id, { closed: !week.closed })}>
              {week.closed ? 'Reopen week' : 'Close week'}
            </button>
          </>
        }
      >
        <EditableText
          className="week-title"
          label="Week title"
          placeholder="Add a title"
          value={week.title}
          onSave={(title) => patchWeek(week.id, { title })}
        />
      </PageHeader>

      <WeekSummary entries={entries} />

      <section className="section">
        <h2 className="section-title">Notes</h2>
        <EditableText
          multiline
          className="notes"
          label="Week notes"
          placeholder="Anything worth remembering about this week — context, decisions, what to try next time."
          value={week.notes}
          onSave={(notes) => patchWeek(week.id, { notes })}
        />
      </section>

      <section className="section">
        <h2 className="section-title">Entries</h2>
        {entries.length === 0 ? (
          <EmptyState title="No one is in this week yet." />
        ) : (
          <ol className="entries">
            {entries.map((e) => (
              <EntryCard
                key={e.memberId}
                week={week}
                entry={e}
                entries={entries}
                participants={participants}
                onPatch={(patch) => patchEntry(week.id, e.memberId, patch)}
                onRemove={() => mutate(() => api.removeEntry(week.id, e.memberId))}
              />
            ))}
          </ol>
        )}
        {!week.closed && others.length > 0 && (
          <div className="add-participant">
            <label htmlFor="add-participant">Add to this week</label>
            <select
              id="add-participant"
              className="input select"
              value=""
              onChange={(e) => e.target.value && patchEntry(week.id, Number(e.target.value), {})}
            >
              <option value="">Choose a person</option>
              {others.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <footer className="danger-zone">
        <button className="button-link danger" onClick={remove}>
          Delete this week
        </button>
      </footer>
    </article>
  );
}

function WeekSummary({ entries }: { entries: Entry[] }) {
  const { lookup } = useStore();
  const count = (o: Entry['outcome']) => entries.filter((e) => e.outcome === o).length;
  const mostPicked = (key: 'excusePickId' | 'betPickId') => {
    const tally = new Map<number, number>();
    for (const e of entries) if (e[key] != null) tally.set(e[key]!, (tally.get(e[key]!) ?? 0) + 1);
    const max = Math.max(0, ...tally.values());
    if (max < 2) return null;
    const names = [...tally].filter(([, n]) => n === max).map(([id]) => lookup.name(id));
    return `${names.join(', ')} (${max})`;
  };
  const doubted = mostPicked('excusePickId');
  const backed = mostPicked('betPickId');

  return (
    <dl className="summary">
      <div>
        <dt>Participants</dt>
        <dd>{entries.length}</dd>
      </div>
      {(['done', 'partial', 'failed', 'pending'] as const).map((o) => (
        <div key={o}>
          <dt>{OUTCOME_LABEL[o]}</dt>
          <dd className={`is-${o}`}>{count(o)}</dd>
        </div>
      ))}
      {doubted && (
        <div className="wide">
          <dt>Most doubted</dt>
          <dd>
            <bdi>{doubted}</bdi>
          </dd>
        </div>
      )}
      {backed && (
        <div className="wide">
          <dt>Most backed</dt>
          <dd>
            <bdi>{backed}</bdi>
          </dd>
        </div>
      )}
    </dl>
  );
}

function EntryCard(props: {
  week: Week;
  entry: Entry;
  entries: Entry[];
  participants: Member[];
  onPatch: (patch: EntryPatch) => void;
  onRemove: () => void;
}) {
  const { lookup } = useStore();
  const { week, entry: e, entries, onPatch } = props;
  const member = lookup.member.get(e.memberId)!;
  const locked = week.closed;
  const doubters = entries.filter((x) => x.excusePickId === e.memberId).map((x) => lookup.name(x.memberId));
  const backers = entries.filter((x) => x.betPickId === e.memberId).map((x) => lookup.name(x.memberId));
  const missed = e.outcome === 'failed' || e.outcome === 'partial';
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <li className="entry">
      <header className="entry-header">
        <PersonLink member={member} />
        {locked ? <OutcomeBadge outcome={e.outcome} /> : <OutcomeControl value={e.outcome} onChange={(outcome) => onPatch({ outcome })} />}
      </header>

      <div className="entry-body">
        <Field label="Goal">
          <EditableText
            multiline
            label={`${member.name}'s goal`}
            placeholder="What are you committing to this week?"
            value={e.goal}
            disabled={locked}
            onSave={(goal) => onPatch({ goal })}
          />
        </Field>

        {(missed || e.excuse) && (
          <Field label="Excuse">
            <EditableText
              multiline
              label={`${member.name}'s excuse`}
              placeholder="What got in the way?"
              value={e.excuse}
              disabled={locked}
              onSave={(excuse) => onPatch({ excuse })}
            />
          </Field>
        )}

        <div className="predictions">
          <Prediction
            label="Calls excuses on"
            members={props.participants}
            self={e.memberId}
            pickId={e.excusePickId}
            reason={e.excuseReason}
            locked={locked}
            correct={predictionResult(e.excusePickId, entries, 'failed')}
            onPick={(excusePickId) => onPatch({ excusePickId })}
            onReason={(excuseReason) => onPatch({ excuseReason })}
          />
          <Prediction
            label="Bets on"
            members={props.participants}
            self={e.memberId}
            pickId={e.betPickId}
            reason={e.betReason}
            locked={locked}
            correct={predictionResult(e.betPickId, entries, 'done')}
            onPick={(betPickId) => onPatch({ betPickId })}
            onReason={(betReason) => onPatch({ betReason })}
          />
        </div>

        {e.notes || notesOpen ? (
          <Field label="Notes">
            <EditableText
              multiline
              autoFocus={notesOpen && !e.notes}
              label={`Notes on ${member.name}'s week`}
              placeholder="Follow-ups, progress, anything to remember"
              value={e.notes}
              onSave={(notes) => onPatch({ notes })}
            />
          </Field>
        ) : null}
      </div>

      <footer className="entry-footer">
        <span>
          Doubted by <bdi>{doubters.length ? doubters.join(', ') : 'no one'}</bdi>
        </span>
        <span>
          Backed by <bdi>{backers.length ? backers.join(', ') : 'no one'}</bdi>
        </span>
        {e.outcome !== 'pending' && <span>{plural(entryPoints(e, outcomesByMember(entries)), 'point')}</span>}
        <span className="entry-footer-actions">
          {!e.notes && !notesOpen && (
            <button className="button-link" onClick={() => setNotesOpen(true)}>
              Add note
            </button>
          )}
          {!locked && (
            <button className="button-link" onClick={props.onRemove}>
              Remove from week
            </button>
          )}
        </span>
      </footer>
    </li>
  );
}

/** true/false once the picked person's outcome is known; undefined while open. */
function predictionResult(pickId: number | null, entries: Entry[], expected: 'done' | 'failed'): boolean | undefined {
  const outcome = entries.find((x) => x.memberId === pickId)?.outcome;
  if (!outcome || outcome === 'pending') return undefined;
  return outcome === expected;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
    </div>
  );
}

function Prediction(props: {
  label: string;
  members: Member[];
  self: number;
  pickId: number | null;
  reason: string;
  locked: boolean;
  correct: boolean | undefined;
  onPick: (id: number | null) => void;
  onReason: (reason: string) => void;
}) {
  return (
    <div className="field prediction">
      <div className="field-label">
        {props.label}
        {props.correct !== undefined && (
          <span className={`verdict ${props.correct ? 'is-right' : 'is-wrong'}`}>{props.correct ? 'Right' : 'Wrong'}</span>
        )}
      </div>
      <MemberSelect
        label={props.label}
        members={props.members}
        exclude={props.self}
        value={props.pickId}
        disabled={props.locked}
        onChange={props.onPick}
      />
      <EditableText
        multiline
        label={`${props.label} — reason`}
        placeholder="Why?"
        value={props.reason}
        disabled={props.locked}
        onSave={props.onReason}
      />
    </div>
  );
}

function CopyMessageButton({ week, entries }: { week: Week; entries: Entry[] }) {
  const { lookup } = useStore();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    // The group writes in Hebrew, so the message keeps the group's own format.
    const text = formatRound(
      entries.map((e) => ({
        name: lookup.name(e.memberId),
        goal: e.goal,
        excuseTarget: lookup.name(e.excusePickId) || null,
        excuseReason: e.excuseReason,
        betTarget: lookup.name(e.betPickId) || null,
        betReason: e.betReason,
      })),
      week.title || undefined,
    );
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy the message:', text);
    }
  };

  return (
    <button className="button" onClick={copy}>
      {copied ? 'Copied' : 'Copy WhatsApp message'}
    </button>
  );
}
