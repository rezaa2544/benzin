import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons.js';

export interface EmptyStateProps {
  title: string;
  body?: string;
  icon?: IconName;
  action?: ReactNode;
}

/** Shown instead of an empty list: one sentence, one optional action. */
export function EmptyState({ title, body, icon = 'orders', action }: EmptyStateProps): JSX.Element {
  return (
    <div className="card flex flex-col items-center gap-2 py-8 text-center">
      <span className="rounded-pill bg-surface2 p-3 text-muted">
        <Icon name={icon} size={28} />
      </span>
      <h3 className="text-base font-bold">{title}</h3>
      {body ? <p className="max-w-[26ch] text-sm text-muted">{body}</p> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
