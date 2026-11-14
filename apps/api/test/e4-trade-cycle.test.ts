import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ManualClock,
  auth,
  createTestContext,
  login,
  orderPayload,
  type TestContext,
} from './helpers.js';

const BANEH = { lat: 35.9983, lng: 45.8851 };

interface OrderBody {
  id: string;
  status: string;
}
interface ReservationBody {
  id: string;
  status: string;
}

describe('E4 — concurrency, timers, cycle gate, contact disclosure and disputes', () => {
  let ctx: TestContext;
  let clock: ManualClock;
  let phone = 150_000_000;

  beforeAll(async () => {
    clock = new ManualClock();
    ctx = await createTestContext(clock);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const freshUser = async () => (await login(ctx, `09${(phone += 1)}`)).token;

  const createOrder = async (token: string, overrides: Record<string, unknown> = {}) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload({ location: BANEH, ...overrides }),
    });
    expect(response.statusCode).toBe(201);
    return response.json() as OrderBody;
  };

  const reserve = (token: string, orderId: string) =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/orders/${orderId}/reservations`,
      headers: auth(token),
    });

  const decide = (token: string, id: string, action: 'confirm' | 'reject' | 'complete') =>
    ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${id}/${action}`,
      headers: auth(token),
    });

  // E4-01
  it('lets exactly one of 50 simultaneous reservation requests win', async () => {
    const owner = await freshUser();
    const order = await createOrder(owner);
    const takers = await Promise.all(Array.from({ length: 50 }, () => freshUser()));

    const responses = await Promise.all(takers.map((token) => reserve(token, order.id)));
    const winners = responses.filter((response) => response.statusCode === 201);
    expect(winners).toHaveLength(1);
    for (const response of responses.filter((r) => r.statusCode !== 201)) {
      expect([409, 429]).toContain(response.statusCode);
    }

    const stored = await ctx.repos.orders.findById(order.id);
    expect(stored?.status).toBe('RESERVED');
    const active = await ctx.repos.reservations.findActiveByOrder(order.id);
    expect(active).not.toBeNull();
  });

  // E4-02
  it('runs the expiry timers repeatedly without side effects', async () => {
    const owner = await freshUser();
    const taker = await freshUser();
    const order = await createOrder(owner);
    const created = (await reserve(taker, order.id)).json() as ReservationBody;

    clock.advanceMinutes(6); // owner decision window is 5 minutes

    const first = await ctx.services.reservations.expireDueReservations();
    expect(first).toBeGreaterThanOrEqual(1);
    const second = await ctx.services.reservations.expireDueReservations();
    expect(second).toBe(0);

    const stored = await ctx.repos.reservations.findById(created.id);
    expect(stored?.status).toBe('EXPIRED');
    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('OPEN');
  });

  it('auto-completes a confirmed trade after the configured window', async () => {
    const owner = await freshUser();
    const taker = await freshUser();
    const order = await createOrder(owner);
    const reservation = (await reserve(taker, order.id)).json() as ReservationBody;
    await decide(owner, reservation.id, 'confirm');

    clock.advanceHours(3); // trade.auto_complete_hours default is 2

    const first = await ctx.services.reservations.autoCompleteDueTrades();
    expect(first).toBeGreaterThanOrEqual(1);
    const second = await ctx.services.reservations.autoCompleteDueTrades();
    expect(second).toBe(0);

    expect((await ctx.repos.reservations.findById(reservation.id))?.status).toBe('AUTO_COMPLETED');
    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('COMPLETED');
  });

  // E4-03 + E4-06
  it('walks the happy path and then blocks a second cycle for the taker', async () => {
    const owner = await freshUser();
    const taker = await freshUser();
    const order = await createOrder(owner);
    const reservation = (await reserve(taker, order.id)).json() as ReservationBody;

    expect((await decide(owner, reservation.id, 'confirm')).statusCode).toBe(200);
    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('CONFIRMED');

    // E4-06: the taker cannot start another cycle while this one is open.
    const blocked = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(taker),
      payload: orderPayload({ location: BANEH }),
    });
    expect(blocked.statusCode).toBe(409);
    expect((blocked.json() as { error: { code: string } }).error.code).toBe('TRADE_CYCLE_BLOCKED');

    expect((await decide(taker, reservation.id, 'complete')).statusCode).toBe(200);
    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('COMPLETED');

    // Once the trade is closed the taker is free again.
    const allowed = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(taker),
      payload: orderPayload({ location: BANEH }),
    });
    expect(allowed.statusCode).toBe(201);
  });

  it('rejects illegal transitions with a stable code', async () => {
    const owner = await freshUser();
    const taker = await freshUser();
    const order = await createOrder(owner);
    const reservation = (await reserve(taker, order.id)).json() as ReservationBody;

    // The taker must not be able to accept their own request.
    const wrongActor = await decide(taker, reservation.id, 'confirm');
    expect(wrongActor.statusCode).toBe(403);

    expect((await decide(owner, reservation.id, 'confirm')).statusCode).toBe(200);
    const secondConfirm = await decide(owner, reservation.id, 'confirm');
    expect(secondConfirm.statusCode).toBe(409);
    expect((secondConfirm.json() as { error: { code: string } }).error.code).toBe(
      'ALREADY_DECIDED',
    );

    const lateReject = await decide(owner, reservation.id, 'reject');
    expect(lateReject.statusCode).toBe(409);
  });

  // E4-05
  it('keeps phone numbers hidden until the owner accepts', async () => {
    const owner = await freshUser();
    const taker = await freshUser();
    const outsider = await freshUser();
    const order = await createOrder(owner);
    const reservation = (await reserve(taker, order.id)).json() as ReservationBody;

    const tooEarly = await ctx.app.inject({
      method: 'GET',
      url: `/v1/reservations/${reservation.id}/contact`,
      headers: auth(taker),
    });
    expect(tooEarly.statusCode).toBe(409);
    expect(tooEarly.body).not.toContain('09');

    await decide(owner, reservation.id, 'confirm');

    const revealed = await ctx.app.inject({
      method: 'GET',
      url: `/v1/reservations/${reservation.id}/contact`,
      headers: auth(taker),
    });
    expect(revealed.statusCode).toBe(200);
    const body = revealed.json() as {
      owner: { phone: string };
      taker: { phone: string };
    };
    expect(body.owner.phone).toMatch(/^09\d{9}$/);
    expect(body.taker.phone).toMatch(/^09\d{9}$/);

    const spied = await ctx.app.inject({
      method: 'GET',
      url: `/v1/reservations/${reservation.id}/contact`,
      headers: auth(outsider),
    });
    expect(spied.statusCode).toBe(403);

    const audit = await ctx.repos.audit.list(50);
    expect(audit.some((entry) => entry.action === 'contact.revealed')).toBe(true);
  });

  // E4-04
  it('escalates a confirmed trade into a dispute and freezes it there', async () => {
    const owner = await freshUser();
    const taker = await freshUser();
    const order = await createOrder(owner);
    const reservation = (await reserve(taker, order.id)).json() as ReservationBody;
    await decide(owner, reservation.id, 'confirm');

    const disputed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${reservation.id}/dispute`,
      headers: auth(taker),
      payload: { reason: 'کارت شارژ نشد' },
    });
    expect(disputed.statusCode).toBe(200);
    expect((disputed.json() as ReservationBody).status).toBe('DISPUTED');
    expect((await ctx.repos.orders.findById(order.id))?.status).toBe('DISPUTED');

    // A disputed trade cannot be completed by the parties any more.
    const completion = await decide(taker, reservation.id, 'complete');
    expect(completion.statusCode).toBe(409);
    expect((completion.json() as { error: { code: string } }).error.code).toBe(
      'INVALID_STATE_TRANSITION',
    );
  });
});
