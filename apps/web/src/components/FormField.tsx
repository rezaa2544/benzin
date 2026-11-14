import { useId, type ReactNode } from 'react';
import { t } from '../lib/i18n.js';

export interface FormFieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string;
  }) => ReactNode;
}

/**
 * Label + control + hint/error. The render-prop hands the control its ids so the
 * label/description wiring is never forgotten at a call site.
 */
export function FormField({
  label,
  hint,
  error,
  required = false,
  children,
}: FormFieldProps): JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = error ? hintId : hint ? hintId : '';
  return (
    <div className="mb-4">
      <label htmlFor={id} className="label">
        {label}
        {required ? (
          <span className="ms-1 text-danger" aria-hidden="true">
            *
          </span>
        ) : (
          <span className="ms-1 text-xs font-normal text-muted">({t('common.optional')})</span>
        )}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {error ? (
        <p id={hintId} role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
