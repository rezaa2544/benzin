import { describe, expect, it } from 'vitest';
import {
  REPUTATION_BASE_SCORE,
  REPUTATION_DELTAS,
  REPUTATION_EVENT_FA,
  REPUTATION_EVENT_KINDS,
  REPUTATION_LEVEL_FA,
  REPUTATION_LEVELS,
  ratingEventKind,
  reputationLevel,
  reputationScore,
} from '../src/reputation.js';

const events = (...deltas: number[]) => deltas.map((delta) => ({ delta }));

describe('reputation score', () => {
  it('starts every account at the neutral base score', () => {
    expect(reputationScore([])).toBe(REPUTATION_BASE_SCORE);
  });

  it('sums the event deltas', () => {
    expect(reputationScore(events(5, 5, -3))).toBe(REPUTATION_BASE_SCORE + 7);
  });

  it('clamps to 0…100 so the score can never leave the gauge', () => {
    expect(reputationScore(events(-30, -30, -30))).toBe(0);
    expect(reputationScore(events(40, 40))).toBe(100);
  });

  it('maps scores to the three levels at their documented boundaries', () => {
    expect(reputationLevel(80)).toBe('GOLD');
    expect(reputationLevel(79)).toBe('SILVER');
    expect(reputationLevel(50)).toBe('SILVER');
    expect(reputationLevel(49)).toBe('BRONZE');
    expect(reputationLevel(0)).toBe('BRONZE');
  });

  it('keeps a delta for every event kind and a Persian label for each', () => {
    for (const kind of REPUTATION_EVENT_KINDS) {
      expect(Number.isFinite(REPUTATION_DELTAS[kind])).toBe(true);
      expect(REPUTATION_EVENT_FA[kind]).toMatch(/[\u0600-\u06FF]/);
    }
    for (const level of REPUTATION_LEVELS) {
      expect(REPUTATION_LEVEL_FA[level]).toMatch(/[\u0600-\u06FF]/);
    }
  });
});

describe('quick rating', () => {
  it('turns stars into a reputation event', () => {
    expect(ratingEventKind(5)).toBe('RATING_HIGH');
    expect(ratingEventKind(4)).toBe('RATING_HIGH');
    expect(ratingEventKind(3)).toBe('RATING_MID');
    expect(ratingEventKind(2)).toBe('RATING_LOW');
    expect(ratingEventKind(1)).toBe('RATING_LOW');
  });

  it('rejects anything outside 1…5', () => {
    for (const stars of [0, 6, 2.5, Number.NaN]) {
      expect(() => ratingEventKind(stars)).toThrow(RangeError);
    }
  });

  it('keeps negative ratings heavier than positive ones', () => {
    expect(REPUTATION_DELTAS.RATING_HIGH).toBeGreaterThan(0);
    expect(REPUTATION_DELTAS.RATING_LOW).toBeLessThan(0);
    expect(REPUTATION_DELTAS.RATING_MID).toBe(0);
  });
});
