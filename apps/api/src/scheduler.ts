import type { Clock } from './domain/entities.js';
import type { OrderService } from './modules/orders-service.js';
import type { PaymentService } from './modules/payment-service.js';
import type { ReputationService } from './modules/reputation-service.js';
import type { ReservationService } from './modules/reservations-service.js';

export interface Scheduler {
  tick(): Promise<{
    expiredReservations: number;
    expiredOrders: number;
    autoCompletedTrades: number;
    liftedSuspensions: number;
    reconciledPayments: number;
  }>;
  start(intervalMs?: number): () => void;
}

/**
 * Expiry sweeps. Synchronous in-process implementation; BullMQ moves this out of the API
 * process once Redis is available (task E4).
 */
export function createScheduler(
  reservations: ReservationService,
  orders: OrderService,
  reputation: ReputationService,
  payments: PaymentService,
  _clock: Clock,
): Scheduler {
  const tick = async () => {
    // Billing reconciliation is the safety net for missed callbacks (E7-06).
    const reconciled = await payments.reconcile();
    return {
      expiredReservations: await reservations.expireDueReservations(),
      expiredOrders: await orders.expireDueOrders(),
      autoCompletedTrades: await reservations.autoCompleteDueTrades(),
      // Trust suspensions are time-boxed; releasing them must not need an admin (E6-01).
      liftedSuspensions: await reputation.liftDueSuspensions(),
      reconciledPayments:
        reconciled.expiredPayments + reconciled.healedPayments + reconciled.expiredSubscriptions,
    };
  };

  return {
    tick,
    start(intervalMs = 60_000) {
      const handle = setInterval(() => {
        void tick().catch((error) => console.error('[scheduler] tick failed', error));
      }, intervalMs);
      handle.unref();
      return () => clearInterval(handle);
    },
  };
}
