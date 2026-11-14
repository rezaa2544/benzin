export type Urgency = 'normal' | 'warning' | 'critical' | 'expired';

export const CRITICAL_MS = 2 * 60 * 1000;
export const WARNING_MS = 10 * 60 * 1000;

export interface CountdownState {
  /** Remaining time clamped at zero. */
  remainingMs: number;
  /** 0..1 — how much of the window is left, for the ring. */
  ratio: number;
  /** 0..100 — how much has elapsed; `strokeDashoffset` is driven by this. */
  percentElapsed: number;
  urgency: Urgency;
}

/**
 * One place decides how urgent a countdown is, so the ring, the label and the colour of a
 * reservation can never disagree. A zero or negative total degrades to "expired" instead
 * of dividing by zero.
 */
export function countdownState(
  remainingMs: number,
  totalMs: number,
  now = Date.now(),
  expiresAt?: number,
): CountdownState {
  const remaining =
    expiresAt !== undefined ? Math.max(0, expiresAt - now) : Math.max(0, remainingMs);
  const total = totalMs > 0 ? totalMs : 0;
  const ratio = total === 0 ? 0 : Math.min(1, remaining / total);
  const urgency: Urgency =
    remaining <= 0
      ? 'expired'
      : remaining < CRITICAL_MS
        ? 'critical'
        : remaining < WARNING_MS
          ? 'warning'
          : 'normal';
  return {
    remainingMs: remaining,
    ratio,
    percentElapsed: Math.round((1 - ratio) * 100),
    urgency,
  };
}

/** Ring colour token per urgency — the only mapping in the app. */
export const URGENCY_TOKEN: Record<Urgency, string> = {
  normal: 'text-brand',
  warning: 'text-warning',
  critical: 'text-danger',
  expired: 'text-muted',
};
