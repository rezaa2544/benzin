import type { Clock } from './domain/entities.js';
import type { OrderService } from './modules/orders-service.js';
import type { ReservationService } from './modules/reservations-service.js';

export interface Scheduler {
  tick(): Promise<{ expiredReservations: number; expiredOrders: number }>;
  start(intervalMs?: number): () => void;
}

/**
 * Expiry sweeps. Synchronous in-process implementation; BullMQ moves this out of the API
 * process once Redis is available (task E4).
 */
export function createScheduler(
  reservations: ReservationService,
  orders: OrderService,
  _clock: Clock,
): Scheduler {
  const tick = async () => ({
    expiredReservations: await reservations.expireDueReservations(),
    expiredOrders: await orders.expireDueOrders(),
  });

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
