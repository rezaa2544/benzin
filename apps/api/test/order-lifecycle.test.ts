import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ManualClock,
  auth,
  createTestContext,
  login,
  orderPayload,
  type TestContext,
} from './helpers.js';

interface OrderBody {
  id: string;
  status: string;
  litres: number;
  rateToman: number;
}

describe('order lifecycle (E3-04, E3-05, E3-07)', () => {
  let ctx: TestContext;
  let clock: ManualClock;

  beforeAll(async () => {
    clock = new ManualClock();
    ctx = await createTestContext(clock);
  });

  afterAll(async () => {
    await ctx.close();
  });

  const create = async (token: string, overrides: Record<string, unknown> = {}) => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload(overrides),
    });
    return { response, order: response.json() as OrderBody };
  };

  describe('edit (E3-04)', () => {
    it('lets the owner change litres and price while the order is open', async () => {
      const owner = await login(ctx, '09121000001');
      const { order } = await create(owner.token);
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/v1/orders/${order.id}`,
        headers: auth(owner.token),
        payload: { litres: 25, rateToman: 2_400, note: 'قیمت اصلاح شد' },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ litres: 25, rateToman: 2_400, status: 'OPEN' });
    });

    it('rejects an edit by somebody else', async () => {
      const owner = await login(ctx, '09121000002');
      const other = await login(ctx, '09121000003');
      const { order } = await create(owner.token);
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/v1/orders/${order.id}`,
        headers: auth(other.token),
        payload: { litres: 10 },
      });
      expect(response.statusCode).toBe(403);
    });

    it('refuses to edit a reserved order', async () => {
      const owner = await login(ctx, '09121000004');
      const taker = await login(ctx, '09121000005');
      const { order } = await create(owner.token);
      await ctx.app.inject({
        method: 'POST',
        url: `/v1/orders/${order.id}/reservations`,
        headers: auth(taker.token),
      });
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/v1/orders/${order.id}`,
        headers: auth(owner.token),
        payload: { litres: 12 },
      });
      expect(response.statusCode).toBe(409);
      expect((response.json() as { error: { code: string } }).error.code).toBe(
        'INVALID_STATE_TRANSITION',
      );
    });

    it('rejects an empty patch', async () => {
      const owner = await login(ctx, '09121000006');
      const { order } = await create(owner.token);
      const response = await ctx.app.inject({
        method: 'PATCH',
        url: `/v1/orders/${order.id}`,
        headers: auth(owner.token),
        payload: {},
      });
      expect(response.statusCode).toBe(422);
    });
  });

  describe('expiry sweep (E3-05)', () => {
    it('expires the order once, hides it from search, and is idempotent', async () => {
      const owner = await login(ctx, '09121000007');
      const zoneId = (await ctx.repos.zones.findByPoint({ lat: 35.9983, lng: 45.8851 }))!.id;
      const { order } = await create(owner.token, {
        side: 'BUY',
        tier: 'T10000',
        litres: 30,
        rateToman: 8_000,
      });
      const listUrl = `/v1/orders?zoneId=${zoneId}&side=BUY&tier=T10000&limit=50`;

      // 25h later the 24h order is overdue; the access token expired too, so log in again.
      clock.advanceHours(25);
      const later = await login(ctx, '09121000007');

      const firstPass = await ctx.services.orders.expireDueOrders();
      expect(firstPass).toBeGreaterThanOrEqual(1);
      const secondPass = await ctx.services.orders.expireDueOrders();
      expect(secondPass).toBe(0);

      const list = await ctx.app.inject({
        method: 'GET',
        url: listUrl,
        headers: auth(later.token),
      });
      expect(list.statusCode).toBe(200);
      expect((list.json() as { items: { id: string }[] }).items.map((i) => i.id)).not.toContain(
        order.id,
      );

      const mine = await ctx.app.inject({
        method: 'GET',
        url: '/v1/orders/mine',
        headers: auth(later.token),
      });
      const stored = (mine.json() as { items: OrderBody[] }).items.find((i) => i.id === order.id);
      expect(stored?.status).toBe('EXPIRED');
    });
  });

  describe('live feed (E3-07)', () => {
    it('hides a reserved order from other users immediately', async () => {
      const owner = await login(ctx, '09121000008');
      const taker = await login(ctx, '09121000009');
      const watcher = await login(ctx, '09121000010');
      const zoneId = (await ctx.repos.zones.findByPoint({ lat: 35.9983, lng: 45.8851 }))!.id;

      const { order } = await create(owner.token, { side: 'SELL', tier: 'T3000' });
      const listUrl = `/v1/orders?zoneId=${zoneId}&side=SELL&tier=T3000&limit=50`;

      const visible = await ctx.app.inject({
        method: 'GET',
        url: listUrl,
        headers: auth(watcher.token),
      });
      expect((visible.json() as { items: { id: string }[] }).items.map((i) => i.id)).toContain(
        order.id,
      );

      const started = Date.now();
      await ctx.app.inject({
        method: 'POST',
        url: `/v1/orders/${order.id}/reservations`,
        headers: auth(taker.token),
      });
      const after = await ctx.app.inject({
        method: 'GET',
        url: listUrl,
        headers: auth(watcher.token),
      });
      const elapsed = Date.now() - started;

      expect((after.json() as { items: { id: string }[] }).items.map((i) => i.id)).not.toContain(
        order.id,
      );
      expect(elapsed).toBeLessThan(2_000);
    });
  });
});
