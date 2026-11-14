import { REPUTATION_LEVEL_FA, reputationLevel, type ReputationLevel } from '@benzin/shared';

export interface TierView {
  level: ReputationLevel;
  label: string;
  /** Tailwind text colour token for the badge glyph. */
  tone: string;
  /** Tailwind background token for the badge pill. */
  surface: string;
}

const TONES: Record<ReputationLevel, { tone: string; surface: string }> = {
  GOLD: { tone: 'text-gold', surface: 'bg-gold/12' },
  SILVER: { tone: 'text-silver', surface: 'bg-silver/15' },
  BRONZE: { tone: 'text-bronze', surface: 'bg-bronze/12' },
};

/** Score → level via the shared thresholds (A22), plus the colours the app renders. */
export function tierView(score: number): TierView {
  const level = reputationLevel(score);
  return { level, label: REPUTATION_LEVEL_FA[level], ...TONES[level] };
}
