import { formatCountdown } from '@benzin/shared';
import { countdownState, URGENCY_TOKEN } from '../lib/countdown.js';
import { t } from '../lib/i18n.js';

export interface CountdownRingProps {
  remainingMs: number;
  totalMs: number;
  size?: number;
  label?: string;
}

const URGENCY_HINT = {
  normal: null,
  warning: 'countdown.warning',
  critical: 'countdown.critical',
  expired: 'common.expired',
} as const;

/**
 * Circular countdown for a reservation window. The stroke offset is derived from one
 * helper (`countdownState`) so the ring, its colour and its label always agree.
 */
export function CountdownRing({
  remainingMs,
  totalMs,
  size = 64,
  label,
}: CountdownRingProps): JSX.Element {
  const state = countdownState(remainingMs, totalMs);
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const hintKey = URGENCY_HINT[state.urgency];

  return (
    <div className="inline-flex items-center gap-3">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={URGENCY_TOKEN[state.urgency]}
        role="img"
        aria-label={`${label ?? t('order.countdown')}: ${formatCountdown(state.remainingMs)}`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={stroke}
        />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={(circumference * state.percentElapsed) / 100}
            className="transition-[stroke-dashoffset] duration-base ease-out"
          />
        </g>
      </svg>
      <div className="flex flex-col">
        <span className="text-xs text-muted">{label ?? t('order.countdown')}</span>
        <span
          className={`text-sm font-bold tnum ${state.urgency === 'expired' ? 'text-muted' : ''}`}
        >
          {formatCountdown(state.remainingMs)}
        </span>
        {hintKey ? <span className="text-[0.6875rem] text-muted">{t(hintKey)}</span> : null}
      </div>
    </div>
  );
}
