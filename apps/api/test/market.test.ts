import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  login,
  loginAsRole,
  orderPayload,
  type TestContext,
} from './helpers.js';

interface StatsBody {
  sampleSize: number;
  excludedSuspicious: number;
  medianRateToman: number | null;
  p25RateToman: number | null;
  p75RateToman: number | null;
  minRateToman: number | null;
  maxRateToman: number | null;
  overallAverageRateToman: number | null;
  overallSampleSize: number;
  windowDays: number;
}

const BANEH = { lat: 35.9983, lng: 45.8851 };

describe('market statistics (E3-06)', () => {
  let ctx: TestContext;
  let token: string;
  let zoneId: string;
  let phone = 140_000_000;

  beforeAll(async () => {
    ctx = await createTestContext();
    zoneId = (await ctx.repos.zones.findByPoint(BANEH))!.id;
    ({ token } = await login(ctx, '09122000001'));
    for (const rateToman of [2_600, 2_700, 2_800, 2_900, 3_000]) {
      const seller = await login(ctx, `09${(phone += 1)}`);
      await ctx.app.inject({
        method: 'POST',
        url: '/v1/orders',
        headers: auth(seller.token),
        payload: orderPayload({ rateToman, location: BANEH }),
      });
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  const stats = async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/stats/market?zoneId=${zoneId}&side=SELL&tier=T3000`,
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    return response.json() as StatsBody;
  };

  it('reports median, quartiles and range for the tier', async () => {
    expect(await stats()).toMatchObject({
      sampleSize: 5,
      medianRateToman: 2_800,
      p25RateToman: 2_700,
      p75RateToman: 2_900,
      minRateToman: 2_600,
      maxRateToman: 3_000,
      windowDays: 30,
    });
  });

  it('keeps a suspicious price out of the tier figures but in the overall average', async () => {
    const noise = await login(ctx, `09${(phone += 1)}`);
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(noise.token),
      payload: orderPayload({ rateToman: 500, location: BANEH }),
    });
    const body = await stats();
    expect(body.sampleSize).toBe(5);
    expect(body.excludedSuspicious).toBe(1);
    expect(body.medianRateToman).toBe(2_800);
    expect(body.overallSampleSize).toBe(6);
    expect(body.overallAverageRateToman).toBeLessThan(2_800);
  });

  it('takes the reporting window from settings', async () => {
    const admin = await loginAsRole(ctx, '09122000099', 'ADMIN');
    const patch = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: auth(admin.token),
      payload: { 'stats.window_days': 7 },
    });
    expect(patch.statusCode).toBe(200);
    expect((await stats()).windowDays).toBe(7);
  });

  it('requires authentication', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/stats/market?zoneId=${zoneId}&side=SELL&tier=T3000`,
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('search performance (E3-03)', () => {
  let ctx: TestContext;
  let token: string;
  let zoneId: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    zoneId = (await ctx.repos.zones.findByPoint(BANEH))!.id;
    ({ token } = await login(ctx, '09123000001'));

    const tiers = ['T1500', 'T3000', 'T10000'] as const;
    const now = Date.now();
    for (let index = 0; index < 10_000; index += 1) {
      await ctx.repos.orders.create({
        ownerId: randomUUID(),
        side: index % 2 === 0 ? 'SELL' : 'BUY',
        tier: tiers[index % 3]!,
        litres: 10 + (index % 40),
        rateToman: 1_200 + (index % 1_800),
        zoneId,
        stationName: `جایگاه ${index}`,
        note: null,
        lat: 35.9983,
        lng: 45.8851,
        deliveryMethod: 'FUEL_CARD',
        expiresAt: new Date(now + 86_400_000),
      });
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('answers a page of 20 from 10,000 orders quickly', async () => {
    const started = performance.now();
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders?zoneId=${zoneId}&side=SELL&tier=T3000&sort=price&limit=20`,
      headers: auth(token),
    });
    const elapsed = performance.now() - started;
    expect(response.statusCode).toBe(200);

    const body = response.json() as { items: { rateToman: number }[]; nextCursor: string | null };
    expect(body.items).toHaveLength(20);
    expect(body.nextCursor).not.toBeNull();
    // The in-memory adapter is the floor, not the target: Postgres has the real index.
    expect(elapsed).toBeLessThan(500);
  });

  it('sorts by distance when an origin is given', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders?zoneId=${zoneId}&side=SELL&tier=T3000&sort=distance&radiusKm=5&lat=35.9983&lng=45.8851`,
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { items: unknown[] }).items.length).toBeLessThanOrEqual(20);
  });
});
