import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  login,
  orderPayload,
  ZONE_ID,
  type TestContext,
} from './helpers.js';

describe('orders', () => {
  let ctx: TestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    ({ token } = await login(ctx, '09120000001'));
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('creates a selling order with computed totals', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload(),
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      totalToman: number;
      buyerSavingToman: number;
      officialRateToman: number;
      status: string;
      deliveryMethod: string;
    };
    expect(body.totalToman).toBe(52_000);
    expect(body.officialRateToman).toBe(3000);
    expect(body.buyerSavingToman).toBe(8_000);
    expect(body.status).toBe('OPEN');
    expect(body.deliveryMethod).toBe('FUEL_CARD');
  });

  it('refuses a price above the official tier rate', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload({ rateToman: 3500 }),
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { error: { message: string } }).error.message).toContain(
      'official rate',
    );
  });

  it('enforces the litres window from settings', async () => {
    const tooSmall = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload({ litres: 1 }),
    });
    expect(tooSmall.statusCode).toBe(422);
    expect((tooSmall.json() as { error: { details: { min: number } } }).error.details.min).toBe(5);
  });

  it('limits the number of open orders per user', async () => {
    const second = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload({ litres: 10 }),
    });
    expect(second.statusCode).toBe(201);
    const third = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload({ litres: 12 }),
    });
    expect(third.statusCode).toBe(429);
    expect((third.json() as { error: { code: string } }).error.code).toBe('ORDER_LIMIT_REACHED');
  });

  it('searches open orders in a zone, filtered and sorted by price', async () => {
    const buyer = await login(ctx, '09120000002');
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(buyer.token),
      payload: orderPayload({ rateToman: 2100, litres: 30, side: 'SELL' }),
    });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders?zoneId=${ZONE_ID}&side=SELL&tier=T3000&sort=price&limit=10`,
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: { rateToman: number; totalToman: number }[];
      nextCursor: string | null;
    };
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    const rates = body.items.map((item) => item.rateToman);
    expect([...rates].sort((a, b) => a - b)).toEqual(rates);
    expect(body.nextCursor).toBeNull();
  });

  it('paginates with an opaque cursor', async () => {
    const first = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders?zoneId=${ZONE_ID}&side=SELL&tier=T3000&limit=1`,
      headers: auth(token),
    });
    const body = first.json() as { items: unknown[]; nextCursor: string | null };
    expect(body.items).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();

    const second = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders?zoneId=${ZONE_ID}&side=SELL&tier=T3000&limit=1&cursor=${body.nextCursor}`,
      headers: auth(token),
    });
    expect(second.statusCode).toBe(200);
  });

  it('rejects a malformed cursor', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders?zoneId=${ZONE_ID}&side=SELL&tier=T3000&cursor=***`,
      headers: auth(token),
    });
    expect(response.statusCode).toBe(422);
  });

  it('lists only the caller’s orders', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/orders/mine',
      headers: auth(token),
    });
    const body = response.json() as { items: { ownerId: string }[] };
    expect(body.items.length).toBeGreaterThan(0);
  });

  it('lets the owner cancel an open order and blocks strangers', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth((await login(ctx, '09120000003')).token),
      payload: orderPayload(),
    });
    const order = created.json() as { id: string };

    const stranger = await ctx.app.inject({
      method: 'POST',
      url: `/v1/orders/${order.id}/cancel`,
      headers: auth(token),
    });
    expect(stranger.statusCode).toBe(403);

    const ownerToken = (
      await ctx.repos.sessions.create(
        (await ctx.repos.orders.findById(order.id))!.ownerId,
        new Date(Date.now() + 60_000),
      )
    ).token;
    const cancelled = await ctx.app.inject({
      method: 'POST',
      url: `/v1/orders/${order.id}/cancel`,
      headers: auth(ownerToken),
    });
    expect(cancelled.statusCode).toBe(200);
    expect((cancelled.json() as { status: string }).status).toBe('CANCELLED');
  });
});
