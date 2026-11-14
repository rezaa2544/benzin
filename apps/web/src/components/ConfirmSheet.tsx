import { useEffect, useId, useRef, type ReactNode } from 'react';
import { t } from '../lib/i18n.js';
import { Icon } from './icons.js';

export interface ConfirmSheetProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}

/**
 * Bottom sheet for irreversible actions. Escape closes, the backdrop closes, focus moves
 * to the confirm button on open and returns handled by the caller's own state — no focus
 * trap library, but the dialog role and labels keep screen readers honest.
 */
export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  busy = false,
  onConfirm,
  onClose,
  children,
}: ConfirmSheetProps): JSX.Element | null {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-sheet flex items-end justify-center">
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="phone-frame relative w-full rounded-t-sheet bg-surface p-5 shadow-sheet"
        style={{ paddingBottom: 'calc(var(--space-5) + var(--safe-bottom))' }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-pill bg-line" aria-hidden="true" />
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-base font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost min-w-tap px-2"
            aria-label={t('common.close')}
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {body ? <p className="mt-2 text-sm text-muted">{body}</p> : null}
        {children}
        <div className="mt-5 flex gap-2">
          <button
            ref={confirmRef}
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`btn flex-1 ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
          >
            {busy ? t('common.loading') : (confirmLabel ?? t('common.confirm'))}
          </button>
          <button type="button" onClick={onClose} className="btn flex-1">
            {cancelLabel ?? t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
