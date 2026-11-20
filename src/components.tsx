import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Member, Outcome } from '../shared/types.ts';
import { OUTCOME_LABEL } from './format.ts';
import { Link } from './router.tsx';

/**
 * Text that edits in place. Keeps a local draft and saves on blur (or Enter for single-line),
 * so typing doesn't fire a request per keystroke. `dir="auto"` handles Hebrew and English text.
 */
export function EditableText(props: {
  value: string;
  onSave: (value: string) => void;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const { value, onSave, multiline } = props;
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  useEffect(() => setDraft(value), [value]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!multiline || !el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, multiline]);

  const commit = () => {
    if (draft.trim() !== value.trim()) onSave(draft.trim());
  };
  const shared = {
    ref,
    dir: 'auto' as const,
    value: draft,
    disabled: props.disabled,
    autoFocus: props.autoFocus,
    placeholder: props.disabled ? '' : props.placeholder,
    'aria-label': props.label,
    className: `input ${props.className ?? ''}`,
    onBlur: commit,
  };

  if (multiline) {
    return <textarea {...shared} rows={1} onChange={(e) => setDraft(e.target.value)} />;
  }
  return (
    <input
      {...shared}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

export function MemberSelect(props: {
  members: Member[];
  value: number | null;
  onChange: (id: number | null) => void;
  label: string;
  exclude?: number;
  disabled?: boolean;
}) {
  return (
    <select
      className="input select"
      value={props.value ?? ''}
      disabled={props.disabled}
      aria-label={props.label}
      onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">No one</option>
      {props.members
        .filter((m) => m.id !== props.exclude)
        .map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
    </select>
  );
}

const SETTABLE: Outcome[] = ['done', 'partial', 'failed'];

/** Segmented control. Clicking the active option clears it back to "open". */
export function OutcomeControl(props: { value: Outcome; onChange: (o: Outcome) => void; disabled?: boolean }) {
  return (
    <div className="segmented" role="radiogroup" aria-label="Outcome">
      {SETTABLE.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={props.value === o}
          disabled={props.disabled}
          className={`segment is-${o}`}
          onClick={() => props.onChange(props.value === o ? 'pending' : o)}
        >
          {OUTCOME_LABEL[o]}
        </button>
      ))}
    </div>
  );
}

export function OutcomeBadge({ outcome }: { outcome: Outcome }) {
  return <span className={`badge is-${outcome}`}>{OUTCOME_LABEL[outcome]}</span>;
}

/** Small square used in history strips and the standings grid. */
export function OutcomeDot({ outcome, title, to }: { outcome?: Outcome; title: string; to?: string }) {
  const cls = `dot is-${outcome ?? 'none'}`;
  return to ? <Link to={to} className={cls} title={title} aria-label={title} /> : <span className={cls} title={title} />;
}

export function PersonLink({ member }: { member: Member | undefined }) {
  if (!member) return <span className="muted">Unknown</span>;
  return (
    <Link to={`/people/${member.id}`} className="person-link" dir="auto">
      {member.name}
    </Link>
  );
}

export function PageHeader(props: { title: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-main">
        {props.eyebrow && <div className="eyebrow">{props.eyebrow}</div>}
        <h1>{props.title}</h1>
        {props.children}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
