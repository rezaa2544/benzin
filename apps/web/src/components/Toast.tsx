import { useCallback, useState } from 'react';
import { Icon } from './icons.js';
import { t } from '../lib/i18n.js';

export type ToastTone = 'success' | 'error' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  tone?: ToastTone;
}

const TONE: Record<ToastTone, string> = {
  success: 'border-s-success text-success',
  error: 'border-s-danger text-danger',
  info: 'border-s-brand text-brand',
};

const TONE_ICON = { success: 'check', error: 'close', info: 'bell' } as const;

/** Single toast line; lives at the bottom of the viewport, above the nav. */
export function Toast({
  message,
  tone = 'info',
  onDismiss,
}: {
  message: string;
  tone?: ToastTone;
  onDismiss: () => void;
}): JSX.Element {
  return (
    <div
      role="status"
      className={`card flex items-center justify-between gap-3 border-s-4 ${TONE[tone]} py-3`}
    >
      <span className="flex items-center gap-2 text-sm text-ink">
        <Icon name={TONE_ICON[tone]} size={16} />
        {message}
      </span>
      <button
        type="button"
        onClick={onDismiss}
        className="btn btn-ghost min-w-tap px-2"
        aria-label={t('common.close')}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export interface ToastStackProps {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastStack({ toasts, onDismiss }: ToastStackProps): JSX.Element | null {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed inset-x-0 z-toast flex flex-col gap-2 px-4"
      style={{ bottom: 'calc(var(--nav-height) + var(--safe-bottom) + var(--space-3))' }}
    >
      <div className="phone-frame flex flex-col gap-2 px-0">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            tone={toast.tone}
            onDismiss={() => onDismiss(toast.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** Small hook so screens do not each reinvent toast bookkeeping. */
export function useToasts(): {
  toasts: ToastItem[];
  push: (message: string, tone?: ToastTone) => void;
  dismiss: (id: string) => void;
} {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const push = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((current) => [...current.slice(-2), { id, message, tone }]);
  }, []);
  return { toasts, push, dismiss };
}
