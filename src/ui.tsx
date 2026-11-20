import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefCallback,
  type TextareaHTMLAttributes,
} from 'react';
import type { Outcome, RoundStatus } from '../shared/types.ts';
import { initials } from './format.ts';
import { useI18n } from './i18n.tsx';

/* ---------- icons (24px grid, stroke) ---------- */

const ICONS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  lock: 'M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  link: 'M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.87M15.5 3.13a3.5 3.5 0 010 6.74',
  crown: 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10.6 10.6 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.8-1.3M9.9 9.9a3 3 0 004.2 4.2',
  target: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 16a4 4 0 100-8 4 4 0 000 8zM12 12h.01',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  settings:
    'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 010-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 014 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 010 4h-.1a1.7 1.7 0 00-1.5 1z',
  history: 'M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 01-10 0zM17 5h3v2a3 3 0 01-3 3M7 5H4v2a3 3 0 003 3',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  camera: 'M3 8h3l2-3h8l2 3h3v12H3zM12 17a4 4 0 100-8 4 4 0 000 8z',
  image: 'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M15.5 9a1.5 1.5 0 100-3 1.5 1.5 0 000 3z',
  globe: 'M12 21a9 9 0 100-18 9 9 0 000 18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
} as const;

/** Icons that point in the reading direction and should mirror in right-to-left layouts. */
const DIRECTIONAL = new Set<string>(['chevronLeft', 'chevronRight', 'logout']);

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={`icon ${DIRECTIONAL.has(name) ? 'icon-directional' : ''} ${className ?? ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={ICONS[name]} />
    </svg>
  );
}

/* ---------- buttons ---------- */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: IconName;
  loading?: boolean;
};

export function Button({ variant = 'secondary', size = 'md', icon, loading, children, className, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`btn btn-${variant} btn-${size} ${className ?? ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden /> : icon && <Icon name={icon} size={size === 'sm' ? 15 : 18} />}
      {children}
    </button>
  );
}

/* ---------- avatars ---------- */

const AVATAR_HUES = [12, 32, 145, 175, 205, 230, 265, 300, 335];

export function Avatar({ name, id, size = 36, ring }: { name: string; id: number; size?: number; ring?: boolean }) {
  const hue = AVATAR_HUES[Math.abs(id) % AVATAR_HUES.length];
  const text = initials(name);
  return (
    <span
      className={`avatar ${ring ? 'avatar-ring' : ''}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4), ['--hue' as string]: hue }}
      title={name}
      aria-hidden
    >
      {text}
    </span>
  );
}

export function AvatarStack({ players, max = 5, size = 28 }: { players: { id: number; name: string }[]; max?: number; size?: number }) {
  const shown = players.slice(0, max);
  const extra = players.length - shown.length;
  return (
    <span className="avatar-stack" aria-label={players.map((p) => p.name).join(', ')}>
      {shown.map((p) => (
        <Avatar key={p.id} id={p.id} name={p.name} size={size} ring />
      ))}
      {extra > 0 && (
        <span className="avatar avatar-more avatar-ring" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
          +{extra}
        </span>
      )}
    </span>
  );
}

/* ---------- status ---------- */

export function Pill({ tone = 'neutral', icon, children }: { tone?: string; icon?: IconName; children: ReactNode }) {
  return (
    <span className={`pill pill-${tone}`}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}

export const OUTCOME_ICON: Record<Outcome, IconName> = { pending: 'clock', done: 'check', partial: 'target', failed: 'x' };

export function OutcomePill({ outcome }: { outcome: Outcome }) {
  const { t } = useI18n();
  return (
    <Pill tone={outcome} icon={OUTCOME_ICON[outcome]}>
      {t.outcome[outcome]}
    </Pill>
  );
}

export function OutcomeDot({ outcome, title }: { outcome?: Outcome; title: string }) {
  return <span className={`dot dot-${outcome ?? 'none'}`} title={title} aria-label={title} role="img" />;
}

const PHASES: RoundStatus[] = ['goals', 'bets', 'live', 'final'];

export function PhaseSteps({ status }: { status: RoundStatus }) {
  const { t } = useI18n();
  const current = PHASES.indexOf(status);
  return (
    <ol className="phases">
      {PHASES.map((p, i) => (
        <li key={p} className={`phase ${i < current ? 'is-past' : ''} ${i === current ? 'is-current' : ''}`} aria-current={i === current ? 'step' : undefined}>
          <span className="phase-marker">{i < current ? <Icon name="check" size={14} /> : i + 1}</span>
          <span className="phase-text">
            <span className="phase-name">{t.phase[p]}</span>
            <span className="phase-hint">{t.phaseHint[p]}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- inputs ---------- */

/** Textarea that grows with its content. */
export function AutoTextarea({
  ref: outerRef,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { ref?: RefCallback<HTMLTextAreaElement> }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return (
    <textarea
      ref={(el) => {
        ref.current = el;
        outerRef?.(el);
      }}
      rows={1}
      dir="auto"
      {...props}
      className={`input ${props.className ?? ''}`}
    />
  );
}

/** Choose one player from the table by avatar. */
export function PlayerPicker(props: {
  players: { id: number; name: string }[];
  value: number | null;
  onChange: (id: number | null) => void;
  label: string;
  tone: 'call' | 'bet' | 'vote';
}) {
  return (
    <div className={`picker picker-${props.tone}`} role="radiogroup" aria-label={props.label}>
      {props.players.map((p) => {
        const on = props.value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            className="picker-option"
            onClick={() => props.onChange(on ? null : p.id)}
          >
            <Avatar id={p.id} name={p.name} size={40} />
            <span className="picker-name" dir="auto">
              {p.name}
            </span>
            {on && (
              <span className="picker-check">
                <Icon name="check" size={12} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- layout bits ---------- */

export function EmptyState({ icon, title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon">
          <Icon name={icon} size={22} />
        </span>
      )}
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${className ?? ''}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div className="modal-card">
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t.common.close}>
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </dialog>
  );
}

export function Spinner() {
  const { t } = useI18n();
  return (
    <div className="page-loading" role="status" aria-label={t.common.loading}>
      <span className="spinner spinner-lg" />
    </div>
  );
}

/* ---------- toasts ---------- */

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error';
}

const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 6000 : 2600);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.tone === 'error' ? <Icon name="x" size={16} /> : <Icon name="check" size={16} />}
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

/** Copy text and confirm with a toast. */
export function useCopy() {
  const toast = useToast();
  const { t } = useI18n();
  return async (text: string, label = t.common.copied) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(label);
    } catch {
      window.prompt(t.common.copyPrompt, text);
    }
  };
}
