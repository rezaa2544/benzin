import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '@benzin/shared';
import { auth, createTestContext, login, orderPayload, type TestContext } from './helpers.js';

let phoneSeq = 0;

/** A brand new seller per test: the open-order cap is per user, not per test context. */
const newOwner = async (ctx: TestContext): Promise<string> =>
  (await login(ctx, `0912${String(6_000_000 + phoneSeq++).padStart(7, '0')}`)).token;

const createOrder = async (ctx: TestContext, token: string): Promise<string> => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: auth(token),
    payload: orderPayload(),
  });
  if (response.statusCode !== 201) throw new Error(response.body);
  return (response.json() as { id: string }).id;
};

describe('reservations', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let takerToken: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    ownerToken = (await login(ctx, '09121000001')).token;
    takerToken = (await login(ctx, '09121000002')).token;
    void ownerToken;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('walks the full happy path: request → accept → complete', async () => {
    const ownerToken = await newOwner(ctx);
    const orderId = await createOrder(ctx, ownerToken);

    const requested = await ctx.app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/reservations`,
      headers: auth(takerToken),
    });
    expect(requested.statusCode).toBe(201);
    const reservation = requested.json() as { id: string; status: string };
    expect(reservation.status).toBe('PENDING_OWNER');

    const orderAfterReserve = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: auth(ownerToken),
    });
    expect((orderAfterReserve.json() as { status: string }).status).toBe('RESERVED');

    const confirmed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${reservation.id}/confirm`,
      headers: auth(ownerToken),
    });
    expect(confirmed.statusCode).toBe(200);
    expect((confirmed.json() as { status: string }).status).toBe('CONFIRMED');

    const completed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${reservation.id}/complete`,
      headers: auth(takerToken),
    });
    expect(completed.statusCode).toBe(200);
    expect((completed.json() as { status: string }).status).toBe('COMPLETED');

    const order = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: auth(ownerToken),
    });
    expect((order.json() as { status: string }).status).toBe('COMPLETED');
  });

  it('blocks self-reservation of your own order', async () => {
    const ownerToken = await newOwner(ctx);
    const orderId = await createOrder(ctx, ownerToken);
    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/reservations`,
      headers: auth(ownerToken),
    });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe('TRADE_CYCLE_BLOCKED');
  });

  it('releasing a rejected request re-opens the order', async () => {
    const ownerToken = await newOwner(ctx);
    const orderId = await createOrder(ctx, ownerToken);
    const requested = await ctx.app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/reservations`,
      headers: auth(takerToken),
    });
    const reservationId = (requested.json() as { id: string }).id;

    const rejected = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${reservationId}/reject`,
      headers: auth(ownerToken),
    });
    expect(rejected.statusCode).toBe(200);
    expect((rejected.json() as { status: string }).status).toBe('REJECTED');

    const order = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: auth(ownerToken),
    });
    expect((order.json() as { status: string }).status).toBe('OPEN');
  });

  it('records who cancelled a confirmed trade', async () => {
    const ownerToken = await newOwner(ctx);
    const orderId = await createOrder(ctx, ownerToken);
    const requested = await ctx.app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/reservations`,
      headers: auth(takerToken),
    });
    const reservationId = (requested.json() as { id: string }).id;
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${reservationId}/confirm`,
      headers: auth(ownerToken),
    });

    const cancelled = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${reservationId}/cancel`,
      headers: auth(takerToken),
      payload: { reason: 'OWNER_UNRESPONSIVE' },
    });
    expect((cancelled.json() as { status: string; cancelReason: string }).status).toBe(
      'CANCELLED_BY_TAKER',
    );
    expect((cancelled.json() as { cancelReason: string }).cancelReason).toBe('OWNER_UNRESPONSIVE');
  });

  it('allows exactly one taker when fifty reserve the same order concurrently', async () => {
    const ownerToken = await newOwner(ctx);
    const orderId = await createOrder(ctx, ownerToken);
    const takers = await Promise.all(
      Array.from({ length: 50 }, async (_, index) => {
        const phone = `0912${String(5000000 + index).padStart(7, '0')}`;
        const { token } = await login(ctx, phone);
        return token;
      }),
    );

    const results = await Promise.all(
      takers.map((token) =>
        ctx.app.inject({
          method: 'POST',
          url: `/v1/orders/${orderId}/reservations`,
          headers: auth(token),
        }),
      ),
    );

    const created = results.filter((r) => r.statusCode === 201);
    const conflicts = results.filter((r) => r.statusCode === 409);
    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(49);

    const active = await ctx.repos.reservations.findActiveByOrder(orderId);
    expect(active).not.toBeNull();
  });

  it('expires a stale pending request and re-opens the order', async () => {
    const ownerToken = await newOwner(ctx);
    const orderId = await createOrder(ctx, ownerToken);
    const requested = await ctx.app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/reservations`,
      headers: auth(takerToken),
    });
    const reservationId = (requested.json() as { id: string }).id;

    const farFuture = { now: () => new Date(Date.now() + 60 * 60 * 1000) };
    const { ReservationService } = await import('../src/modules/reservations-service.js');
    const { SettingsService } = await import('../src/modules/settings-service.js');
    const service = new ReservationService(ctx.repos, new SettingsService(ctx.repos), farFuture);
    expect(await service.expireDueReservations()).toBeGreaterThanOrEqual(1);

    const order = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders/${orderId}`,
      headers: auth(ownerToken),
    });
    expect((order.json() as { status: string }).status).toBe('OPEN');

    const late = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${reservationId}/confirm`,
      headers: auth(ownerToken),
    });
    expect(late.statusCode).toBe(409);
    expect((late.json() as { error: { code: string } }).error.code).toBe('ALREADY_DECIDED');
    expect(new AppError('CONFLICT', 409, 'x').httpStatus).toBe(409);
  });

  it('hides a reservation from unrelated users', async () => {
    const ownerToken = await newOwner(ctx);
    const orderId = await createOrder(ctx, ownerToken);
    const requested = await ctx.app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/reservations`,
      headers: auth(takerToken),
    });
    const reservationId = (requested.json() as { id: string }).id;

    const outsider = (await login(ctx, '09121000009')).token;
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/reservations/${reservationId}`,
      headers: auth(outsider),
    });
    expect(response.statusCode).toBe(403);
  });
});
