import { useEffect, useState, type ReactNode } from 'react';
import type { Member, Outcome } from '../shared/types.ts';

/** Text input that keeps its own draft and saves on blur / Enter. */
export function EditableText(props: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);
  const commit = () => {
    if (draft.trim() !== props.value.trim()) props.onSave(draft);
  };
  const common = {
    value: draft,
    placeholder: props.placeholder,
    disabled: props.disabled,
    'aria-label': props.ariaLabel ?? props.placeholder,
    className: `field ${props.className ?? ''}`,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
  };
  if (props.multiline) {
    return (
      <textarea
        {...common}
        rows={Math.max(1, Math.ceil(draft.length / 42))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />
    );
  }
  return <input {...common} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />;
}

export function MemberSelect(props: {
  members: Member[];
  value: number | null;
  exclude?: number;
  onChange: (id: number | null) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  return (
    <select
      className="field select"
      value={props.value ?? ''}
      disabled={props.disabled}
      aria-label={props.placeholder}
      onChange={(e) => props.onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{props.placeholder}</option>
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

export const OUTCOME_META: Record<Outcome, { label: string; icon: string }> = {
  pending: { label: 'עוד לא ידוע', icon: '⏳' },
  done: { label: 'ביצע', icon: '✅' },
  partial: { label: 'חצי', icon: '🤏' },
  failed: { label: 'תירוצים', icon: '🙄' },
};

export function OutcomePicker(props: { value: Outcome; onChange: (o: Outcome) => void; disabled?: boolean }) {
  return (
    <div className="outcomes" role="radiogroup" aria-label="תוצאה">
      {(['done', 'partial', 'failed'] as Outcome[]).map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={props.value === o}
          disabled={props.disabled}
          className={`outcome outcome-${o} ${props.value === o ? 'on' : ''}`}
          onClick={() => props.onChange(props.value === o ? 'pending' : o)}
        >
          <span aria-hidden>{OUTCOME_META[o].icon}</span> {OUTCOME_META[o].label}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.45, background: `hsl(${h} 70% 55%)` }}
      aria-hidden
    >
      {name.trim().charAt(0)}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function formatDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Sunday of the current week, as YYYY-MM-DD (Israeli week). */
export function thisSunday(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
