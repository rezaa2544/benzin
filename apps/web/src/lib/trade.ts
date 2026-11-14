import { ACTIVE_RESERVATION_STATUSES, type ReservationStatus } from '@benzin/shared';
import type { ReservationView } from './types.js';

export type TradeAction =
  'confirm' | 'reject' | 'complete' | 'dispute' | 'cancel' | 'contact' | 'rate';

export type TradeRole = 'taker' | 'owner' | 'spectator';

export function tradeRole(
  reservation: Pick<ReservationView, 'takerId'>,
  userId: string,
  orderOwnerId: string | undefined,
): TradeRole {
  if (reservation.takerId === userId) return 'taker';
  if (orderOwnerId && orderOwnerId === userId) return 'owner';
  return 'spectator';
}

/**
 * The action matrix (E9-09). It mirrors the server rules so the UI never offers a button
 * that the API would reject: only the owner decides, both parties can cancel or dispute a
 * confirmed trade, and only the taker can rate a finished one.
 */
export function tradeActions(
  reservation: Pick<ReservationView, 'status' | 'takerId'>,
  role: TradeRole,
): TradeAction[] {
  const { status } = reservation;
  if (role === 'spectator') return [];
  switch (status) {
    case 'PENDING_OWNER':
      return role === 'owner' ? ['confirm', 'reject'] : ['cancel'];
    case 'CONFIRMED':
      return ['complete', 'dispute', 'cancel', 'contact'];
    case 'COMPLETED':
    case 'AUTO_COMPLETED':
      return role === 'taker' ? ['rate', 'contact'] : ['contact'];
    case 'DISPUTED':
      return [];
    default:
      return [];
  }
}

export const isLive = (status: ReservationStatus): boolean =>
  ACTIVE_RESERVATION_STATUSES.includes(status);

/** Which countdown to show: the owner's decision window, or the whole reservation window. */
export function countdownWindow(
  reservation: Pick<ReservationView, 'status' | 'createdAt' | 'expiresAt'>,
  ownerDecisionMinutes: number,
  nowMs: number = Date.now(),
): { remainingMs: number; totalMs: number } {
  const created = Date.parse(reservation.createdAt);
  const expires = Date.parse(reservation.expiresAt);
  const total = Math.max(0, expires - created);
  if (reservation.status === 'PENDING_OWNER') {
    const decision = Math.min(total, ownerDecisionMinutes * 60_000);
    return { remainingMs: Math.max(0, created + decision - nowMs), totalMs: decision };
  }
  return { remainingMs: Math.max(0, expires - nowMs), totalMs: total };
}
