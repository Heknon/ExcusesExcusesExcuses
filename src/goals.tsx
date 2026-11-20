import { useEffect, useRef, useState } from 'react';
import { combineOutcomes } from '../shared/scoring.ts';
import { GOAL_MAX_LENGTH, MAX_GOALS, type Entry, type Goal, type Outcome, type Round } from '../shared/types.ts';
import { api } from './api.ts';
import { useI18n } from './i18n.tsx';
import { useGame } from './session.tsx';
import { AutoTextarea, Button, Icon, OUTCOME_ICON, Pill } from './ui.tsx';

/* ---------- editing the list ---------- */

export interface GoalDraft {
  key: number;
  id?: number;
  text: string;
}

let nextKey = 1;
export const toDrafts = (goals: Goal[]): GoalDraft[] =>
  goals.length ? goals.map((g) => ({ key: nextKey++, id: g.id, text: g.text })) : [{ key: nextKey++, text: '' }];
export const fromDrafts = (drafts: GoalDraft[]) =>
  drafts.map((d) => ({ ...(d.id != null ? { id: d.id } : {}), text: d.text.trim() })).filter((d) => d.text);

/** Numbered goal inputs. Enter on the last one adds another; empty ones are dropped on save. */
export function GoalsEditor({ value, onChange, autoFocus }: { value: GoalDraft[]; onChange: (d: GoalDraft[]) => void; autoFocus?: boolean }) {
  const { t } = useI18n();
  const focusKey = useRef<number | null>(null);
  const refs = useRef(new Map<number, HTMLTextAreaElement>());

  useEffect(() => {
    if (focusKey.current != null) {
      refs.current.get(focusKey.current)?.focus();
      focusKey.current = null;
    }
  });

  const add = () => {
    if (value.length >= MAX_GOALS) return;
    const d = { key: nextKey++, text: '' };
    focusKey.current = d.key;
    onChange([...value, d]);
  };
  const update = (key: number, text: string) => onChange(value.map((d) => (d.key === key ? { ...d, text } : d)));
  const remove = (key: number) => onChange(value.filter((d) => d.key !== key));

  return (
    <div className="goals-editor">
      <ol className="goals-edit-list">
        {value.map((d, i) => (
          <li key={d.key} className="goal-edit">
            <span className="goal-num" aria-hidden>
              {i + 1}
            </span>
            <AutoTextarea
              ref={(el) => {
                if (el) refs.current.set(d.key, el);
                else refs.current.delete(d.key);
              }}
              value={d.text}
              onChange={(e) => update(d.key, e.target.value.replace(/\n/g, ' '))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (i === value.length - 1 && d.text.trim()) add();
                }
              }}
              placeholder={i === 0 ? t.round.goalPlaceholder : t.round.goalN(i + 1)}
              aria-label={t.round.goalN(i + 1)}
              maxLength={GOAL_MAX_LENGTH}
              autoFocus={autoFocus && i === 0 && !d.text}
            />
            {value.length > 1 && (
              <button type="button" className="icon-btn icon-btn-sm" onClick={() => remove(d.key)} aria-label={t.round.removeGoal}>
                <Icon name="x" size={16} />
              </button>
            )}
          </li>
        ))}
      </ol>
      {value.length < MAX_GOALS && (
        <button type="button" className="link-btn goal-add" onClick={add}>
          <Icon name="plus" size={15} /> {t.round.addGoal}
        </button>
      )}
    </div>
  );
}

/* ---------- showing the list ---------- */

/** Goals with their result icons. `limit` collapses long lists to "+N more". */
export function GoalList({ goals, showOutcomes, limit, inline }: { goals: Goal[]; showOutcomes: boolean; limit?: number; inline?: boolean }) {
  const { t } = useI18n();
  const shown = limit ? goals.slice(0, limit) : goals;
  const extra = goals.length - shown.length;
  // Inside buttons only phrasing content is allowed, hence spans.
  const Wrap = inline ? 'span' : 'ul';
  const Item = inline ? 'span' : 'li';
  return (
    <Wrap className={`goal-list ${goals.length === 1 ? 'is-single' : ''}`}>
      {shown.map((g) => (
        <Item key={g.id} className={`goal-item is-${showOutcomes ? g.outcome : 'none'}`}>
          <span className="goal-mark" aria-hidden>
            {showOutcomes && g.outcome !== 'pending' ? <Icon name={OUTCOME_ICON[g.outcome]} size={12} /> : null}
          </span>
          <span className="goal-text" dir="auto">
            {g.text}
          </span>
          {showOutcomes && g.outcome !== 'pending' && <span className="sr-only">({t.outcome[g.outcome]})</span>}
        </Item>
      ))}
      {extra > 0 && <Item className="goal-item goal-more">{t.round.moreGoals(extra)}</Item>}
    </Wrap>
  );
}

/* ---------- reporting per goal ---------- */

const SETTABLE: Exclude<Outcome, 'pending'>[] = ['done', 'partial', 'failed'];

/** Done / Partly / Missed for each goal. Saves immediately and updates the week's result locally. */
export function GoalReporter({ round, entry }: { round: Round; entry: Entry }) {
  const { gameId, run, patchLocal } = useGame();
  const { t } = useI18n();

  const set = (goal: Goal, outcome: Outcome) => {
    const next: Outcome = goal.outcome === outcome ? 'pending' : outcome;
    patchLocal((s) => ({
      ...s,
      entries: s.entries.map((e) => {
        if (e.roundId !== round.id || e.playerId !== entry.playerId) return e;
        const goals = e.goals.map((g) => (g.id === goal.id ? { ...g, outcome: next } : g));
        return { ...e, goals, outcome: combineOutcomes(goals.map((g) => g.outcome)) };
      }),
    }));
    run(() => api.updateEntry(gameId, round.id, entry.playerId, { goalOutcomes: { [goal.id]: next } }));
  };

  return (
    <ol className="goal-report">
      {entry.goals.map((g, i) => (
        <li key={g.id} className={`goal-report-row is-${g.outcome}`}>
          <span className="goal-num" aria-hidden>
            {i + 1}
          </span>
          <span className="goal-report-text" dir="auto">
            {g.text}
          </span>
          <span className="goal-choices" role="radiogroup" aria-label={g.text}>
            {SETTABLE.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={g.outcome === o}
                className={`goal-choice is-${o}`}
                onClick={() => set(g, o)}
                title={t.outcome[o]}
              >
                <Icon name={OUTCOME_ICON[o]} size={15} />
                <span className="goal-choice-label">{t.outcome[o]}</span>
              </button>
            ))}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- deadline ---------- */

function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "2 days left · Due Sat, Nov 21, 23:59", or "Deadline passed" once it has. */
export function DeadlineBadge({ round, onEdit }: { round: Round; onEdit?: () => void }) {
  const { t, fmt } = useI18n();
  const now = useNow();
  if (round.status === 'final') return null;
  const ms = new Date(round.deadline).getTime() - now;
  const passed = ms <= 0;
  const urgent = !passed && ms < 24 * 3_600_000;
  return (
    <span className="deadline">
      <Pill tone={passed ? 'failed' : urgent ? 'planning' : 'live'} icon="clock">
        {passed ? t.round.deadlinePassed : t.round.timeLeft(fmt.duration(ms))}
      </Pill>
      <span className="deadline-when muted small">{t.round.due(fmt.deadline(round.deadline))}</span>
      {onEdit && (
        <Button size="sm" variant="ghost" icon="edit" onClick={onEdit} aria-label={t.round.changeDeadline} className="deadline-edit" />
      )}
    </span>
  );
}
