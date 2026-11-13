import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors.js';
import {
  canOrderTransition,
  canReservationTransition,
  nextOrderStatus,
  nextReservationStatus,
  ORDER_TRANSITIONS,
  RESERVATION_TRANSITIONS,
} from '../src/state-machine.js';

describe('order state machine', () => {
  it('walks the happy path', () => {
    const reserved = nextOrderStatus('OPEN', 'RESERVE', 'TAKER');
    const confirmed = nextOrderStatus(reserved, 'CONFIRM', 'OWNER');
    expect(reserved).toBe('RESERVED');
    expect(confirmed).toBe('CONFIRMED');
    expect(nextOrderStatus(confirmed, 'COMPLETE', 'OWNER')).toBe('COMPLETED');
  });

  it('returns the order to OPEN when a reservation is released', () => {
    expect(nextOrderStatus('RESERVED', 'RELEASE', 'SYSTEM')).toBe('OPEN');
  });

  it('only lets the owner confirm', () => {
    expect(canOrderTransition('RESERVED', 'CONFIRM', 'TAKER')).toBe(false);
    expect(() => nextOrderStatus('RESERVED', 'CONFIRM', 'TAKER')).toThrow(AppError);
  });

  it('parks an unresponsive owner decision', () => {
    expect(nextOrderStatus('CONFIRMED', 'OWNER_UNRESPONSIVE', 'TAKER')).toBe(
      'AWAITING_OWNER_DECISION',
    );
  });

  it('reserves disputes for admins', () => {
    expect(nextOrderStatus('DISPUTED', 'RESOLVE_COMPLETE', 'ADMIN')).toBe('COMPLETED');
    expect(canOrderTransition('DISPUTED', 'RESOLVE_COMPLETE', 'OWNER')).toBe(false);
  });

  it('has no transitions out of terminal statuses', () => {
    for (const from of ['COMPLETED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(ORDER_TRANSITIONS.filter((t) => t.from === from)).toHaveLength(0);
    }
  });

  it('reports the offending code in the error', () => {
    try {
      nextOrderStatus('COMPLETED', 'RESERVE', 'TAKER');
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('INVALID_STATE_TRANSITION');
      expect((error as AppError).httpStatus).toBe(409);
    }
  });
});

describe('reservation state machine', () => {
  it('expires a pending reservation by timeout', () => {
    expect(nextReservationStatus('PENDING_OWNER', 'TIMEOUT', 'SYSTEM')).toBe('EXPIRED');
  });

  it('auto-completes only for the system', () => {
    expect(canReservationTransition('CONFIRMED', 'AUTO_COMPLETE', 'OWNER')).toBe(false);
    expect(nextReservationStatus('CONFIRMED', 'AUTO_COMPLETE', 'SYSTEM')).toBe('AUTO_COMPLETED');
  });

  it('records who cancelled', () => {
    expect(nextReservationStatus('CONFIRMED', 'CANCEL_TAKER', 'TAKER')).toBe('CANCELLED_BY_TAKER');
    expect(nextReservationStatus('CONFIRMED', 'CANCEL_OWNER', 'OWNER')).toBe('CANCELLED_BY_OWNER');
  });

  it('never leaves a pending reservation unattended', () => {
    const pending = RESERVATION_TRANSITIONS.filter((t) => t.from === 'PENDING_OWNER');
    expect(pending.length).toBeGreaterThanOrEqual(4);
  });
});
