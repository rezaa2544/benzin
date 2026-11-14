import { describe, expect, it } from 'vitest';
import { CRITICAL_MS, WARNING_MS, countdownState, URGENCY_TOKEN } from '../src/lib/countdown.js';

const MIN = 60 * 1000;

describe('countdown model (E9-02)', () => {
  it('marks the last two minutes as critical and the last ten as warning', () => {
    expect(countdownState(30 * MIN, 30 * MIN).urgency).toBe('normal');
    expect(countdownState(CRITICAL_MS + 1, 30 * MIN).urgency).toBe('warning');
    expect(countdownState(WARNING_MS, 30 * MIN).urgency).toBe('normal');
    expect(countdownState(WARNING_MS - 1, 30 * MIN).urgency).toBe('warning');
    expect(countdownState(CRITICAL_MS - 1, 30 * MIN).urgency).toBe('critical');
    expect(countdownState(0, 30 * MIN).urgency).toBe('expired');
  });

  it('never reports negative time or a ratio above one', () => {
    const state = countdownState(-5000, 30 * MIN);
    expect(state.remainingMs).toBe(0);
    expect(state.ratio).toBe(0);
    expect(state.percentElapsed).toBe(100);
    expect(countdownState(60 * MIN, 30 * MIN).ratio).toBe(1);
    expect(countdownState(60 * MIN, 30 * MIN).percentElapsed).toBe(0);
  });

  it('degrades safely when the window length is unknown', () => {
    const state = countdownState(5 * MIN, 0);
    expect(state.ratio).toBe(0);
    expect(state.percentElapsed).toBe(100);
    expect(state.urgency).toBe('warning');
  });

  it('derives the remaining time from an absolute expiry, not a stale duration', () => {
    const now = Date.parse('2026-11-14T10:00:00.000Z');
    const state = countdownState(0, 10 * MIN, now, now + 4 * MIN);
    expect(state.remainingMs).toBe(4 * MIN);
    expect(state.ratio).toBeCloseTo(0.4, 5);
    expect(state.percentElapsed).toBe(60);
  });

  it('has a colour token for every urgency', () => {
    expect(Object.keys(URGENCY_TOKEN).sort()).toEqual(
      ['critical', 'expired', 'normal', 'warning'].sort(),
    );
  });
});
