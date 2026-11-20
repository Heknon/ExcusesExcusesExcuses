import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Entry, Proof } from '../shared/types.ts';
import { api } from './api.ts';
import { useI18n } from './i18n.tsx';
import { prepareImage, UnreadableImageError } from './images.ts';
import { useGame } from './session.tsx';
import { Button, Icon, useToast } from './ui.tsx';

const MAX_PROOFS = 6;

/** Thumbnails; tapping one opens the viewer. */
export function ProofStrip({ entry, max = 4, size = 'md' }: { entry: Entry; max?: number; size?: 'sm' | 'md' }) {
  const { t } = useI18n();
  const { lookup } = useGame();
  const [open, setOpen] = useState<number | null>(null);
  if (!entry.proofs.length) return null;
  const shown = entry.proofs.slice(0, max);
  const extra = entry.proofs.length - shown.length;
  const name = lookup.name(entry.playerId);

  return (
    <>
      <ul className={`proof-strip proof-strip-${size}`} aria-label={t.proof.view(name)}>
        {shown.map((p, i) => (
          <li key={p.id}>
            <button type="button" className="proof-thumb" onClick={() => setOpen(i)} aria-label={`${t.proof.view(name)} · ${t.proof.of(i + 1, entry.proofs.length)}`}>
              <img src={api.proofUrl(p.id)} alt="" loading="lazy" decoding="async" />
              {i === shown.length - 1 && extra > 0 && <span className="proof-more">+{extra}</span>}
            </button>
          </li>
        ))}
      </ul>
      {open !== null && <Lightbox proofs={entry.proofs} start={open} title={t.proof.view(name)} entry={entry} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Full-screen viewer with previous/next, keyboard arrows and swipe. */
function Lightbox({ proofs, start, title, entry, onClose }: { proofs: Proof[]; start: number; title: string; entry: Entry; onClose: () => void }) {
  const { t, dir } = useI18n();
  const { lookup, run } = useGame();
  const ref = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(start);
  const touchX = useRef<number | null>(null);
  const proof = proofs[Math.min(index, proofs.length - 1)];
  const canDelete = lookup.isAdmin || entry.playerId === lookup.me.id;

  const step = useCallback((delta: number) => setIndex((i) => (i + delta + proofs.length) % proofs.length), [proofs.length]);

  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  useEffect(() => {
    if (!proofs.length) onClose();
  }, [proofs.length, onClose]);

  const onKey = (e: KeyboardEvent) => {
    // Arrow keys follow the reading direction: "next" is left in Hebrew.
    const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const back = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === forward) step(1);
    if (e.key === back) step(-1);
  };

  if (!proof) return null;

  return (
    <dialog
      ref={ref}
      className="lightbox"
      aria-label={title}
      onKeyDown={onKey}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 50) step((dx < 0 ? 1 : -1) * (dir === 'rtl' ? -1 : 1));
      }}
    >
      <header className="lightbox-bar">
        <span className="lightbox-title" dir="auto">
          {title}
        </span>
        {proofs.length > 1 && <span className="lightbox-count">{t.proof.of(index + 1, proofs.length)}</span>}
        <span className="lightbox-actions">
          {canDelete && (
            <button
              className="icon-btn icon-btn-light"
              aria-label={t.proof.remove}
              onClick={() => run(() => api.deleteProof(proof.id), t.proof.removed)}
            >
              <Icon name="trash" />
            </button>
          )}
          <button className="icon-btn icon-btn-light" aria-label={t.common.close} onClick={onClose} autoFocus>
            <Icon name="x" />
          </button>
        </span>
      </header>
      <div className="lightbox-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <img key={proof.id} src={api.proofUrl(proof.id)} alt={`${title} · ${t.proof.of(index + 1, proofs.length)}`} />
      </div>
      {proofs.length > 1 && (
        <>
          <button className="lightbox-nav lightbox-prev" aria-label={t.proof.prev} onClick={() => step(-1)}>
            <Icon name="chevronLeft" size={26} />
          </button>
          <button className="lightbox-nav lightbox-next" aria-label={t.proof.next} onClick={() => step(1)}>
            <Icon name="chevronRight" size={26} />
          </button>
        </>
      )}
    </dialog>
  );
}

/** Add photos to an entry: thumbnails plus an add button. Uploads one at a time, shrunk on-device. */
export function ProofUploader({ entry, compact }: { entry: Entry; compact?: boolean }) {
  const { t, errorText } = useI18n();
  const { gameId, run, reload } = useGame();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const remaining = MAX_PROOFS - entry.proofs.length;

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []).slice(0, remaining);
    if (input.current) input.current.value = '';
    if (!list.length) return;
    setBusy(list.length);
    let added = 0;
    for (const file of list) {
      try {
        const blob = await prepareImage(file);
        await api.addProof(gameId, entry.roundId, entry.playerId, blob);
        added++;
      } catch (e) {
        toast(e instanceof UnreadableImageError ? t.proof.unreadable : errorText(e), 'error');
      }
      setBusy((n) => n - 1);
    }
    if (added) await run(async () => undefined, t.proof.added);
    else await reload();
  };

  return (
    <div className={`proof-uploader ${compact ? 'is-compact' : ''}`}>
      {!compact && (
        <div className="proof-uploader-head">
          <span className="field-label">
            <Icon name="camera" size={15} /> {t.proof.title}
          </span>
          <span className="field-hint">{t.proof.hint}</span>
        </div>
      )}
      <div className="proof-uploader-row">
        <ProofStrip entry={entry} max={MAX_PROOFS} />
        {busy > 0 &&
          Array.from({ length: busy }, (_, i) => (
            <span key={i} className="proof-thumb proof-thumb-loading" aria-label={t.proof.uploading}>
              <span className="spinner" />
            </span>
          ))}
        {remaining > 0 && (
          <Button size="sm" icon="camera" onClick={() => input.current?.click()} disabled={busy > 0}>
            {entry.proofs.length ? t.proof.addMore : t.proof.add}
          </Button>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
    </div>
  );
}
