import { describe, expect, it } from 'vitest';
import { countdownWindow, isLive, tradeActions, tradeRole } from '../src/lib/trade.js';
import type { ReservationView } from '../src/lib/types.js';

const MIN = 60_000;

const reservation = (patch: Partial<ReservationView> = {}): ReservationView => ({
  id: 'r1',
  orderId: 'o1',
  takerId: 'taker',
  status: 'CONFIRMED',
  createdAt: '2026-01-01T10:00:00.000Z',
  expiresAt: '2026-01-01T10:30:00.000Z',
  decidedAt: null,
  completedAt: null,
  cancelReason: null,
  ...patch,
});

describe('trade model (E9-09)', () => {
  it('knows which side of the trade the current user is on', () => {
    expect(tradeRole(reservation(), 'taker', 'owner')).toBe('taker');
    expect(tradeRole(reservation(), 'owner', 'owner')).toBe('owner');
    expect(tradeRole(reservation(), 'someone', 'owner')).toBe('spectator');
    expect(tradeRole(reservation(), 'someone', undefined)).toBe('spectator');
  });

  it('offers the owner a decision and the taker only a cancel while pending', () => {
    const pending = reservation({ status: 'PENDING_OWNER' });
    expect(tradeActions(pending, 'owner')).toEqual(['confirm', 'reject']);
    expect(tradeActions(pending, 'taker')).toEqual(['cancel']);
    expect(tradeActions(pending, 'spectator')).toEqual([]);
  });

  it('lets both parties complete, dispute, cancel or share contact once confirmed', () => {
    expect(tradeActions(reservation(), 'taker')).toEqual([
      'complete',
      'dispute',
      'cancel',
      'contact',
    ]);
    expect(tradeActions(reservation(), 'owner')).toContain('complete');
  });

  it('only offers rating to the taker after a finished trade', () => {
    expect(tradeActions(reservation({ status: 'COMPLETED' }), 'taker')).toContain('rate');
    expect(tradeActions(reservation({ status: 'AUTO_COMPLETED' }), 'owner')).not.toContain('rate');
    expect(tradeActions(reservation({ status: 'COMPLETED' }), 'spectator')).toEqual([]);
  });

  it('offers nothing while disputed or already cancelled', () => {
    expect(tradeActions(reservation({ status: 'DISPUTED' }), 'owner')).toEqual([]);
    expect(tradeActions(reservation({ status: 'CANCELLED_BY_TAKER' }), 'taker')).toEqual([]);
    expect(tradeActions(reservation({ status: 'EXPIRED' }), 'taker')).toEqual([]);
  });

  it('treats pending and confirmed reservations as live', () => {
    expect(isLive('PENDING_OWNER')).toBe(true);
    expect(isLive('CONFIRMED')).toBe(true);
    expect(isLive('COMPLETED')).toBe(false);
    expect(isLive('CANCELLED_BY_TAKER')).toBe(false);
    expect(isLive('REJECTED')).toBe(false);
  });

  it('uses the decision window while pending and the whole window once confirmed', () => {
    const created = Date.parse('2026-01-01T10:00:00.000Z');
    const pending = countdownWindow(reservation({ status: 'PENDING_OWNER' }), 5, created + MIN);
    expect(pending.totalMs).toBe(5 * MIN);
    expect(pending.remainingMs).toBe(4 * MIN);

    const confirmed = countdownWindow(reservation(), 5, created + 10 * MIN);
    expect(confirmed.totalMs).toBe(30 * MIN);
    expect(confirmed.remainingMs).toBe(20 * MIN);
  });

  it('never returns negative remaining time', () => {
    const later = Date.parse('2026-01-01T12:00:00.000Z');
    expect(countdownWindow(reservation(), 5, later).remainingMs).toBe(0);
    expect(countdownWindow(reservation({ status: 'PENDING_OWNER' }), 5, later).remainingMs).toBe(0);
  });
});
