import { t } from '../lib/i18n.js';
import { tierView } from '../lib/tier.js';
import { toPersianDigits } from '@benzin/shared';

export interface TierBadgeProps {
  score: number;
  /** Show the numeric score next to the level name. */
  showScore?: boolean;
}

/** Reputation pill: level name from the shared thresholds plus the score in Persian digits. */
export function TierBadge({ score, showScore = true }: TierBadgeProps): JSX.Element {
  const view = tierView(score);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-xs font-medium ${view.surface} ${view.tone}`}
      title={`${t('order.tier')}: ${toPersianDigits(score)}`}
    >
      <span aria-hidden="true">★</span>
      <span>{view.label}</span>
      {showScore ? <span className="tnum opacity-80">{toPersianDigits(score)}</span> : null}
    </span>
  );
}
