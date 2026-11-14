import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RouteProvider } from '../src/ports.js';
import { auth, createTestContext, login, orderPayload, type TestContext } from './helpers.js';

const BANEH = { lat: 35.9983, lng: 45.8851 };
const TEHRAN = { lat: 35.6997, lng: 51.338 };
const FAR_ZONE_ID = '0b9c1c3e-5f7a-4d2b-9e8f-1234567890ab';

interface OrderBody {
  id: string;
  location: { lat: number; lng: number; approximate: boolean; precisionMeters: number } | null;
  distance?: {
    distanceMeters: number;
    durationSeconds: number;
    etaMinutes: number;
    approximate: boolean;
    source: string;
  };
}

let phoneSeq = 0;
/** Each case needs its own user: the open-order limit is per user. */
const freshPhone = (): string => `09${100_000_000 + (phoneSeq += 1)}`;

describe('location service (E2-02)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const create = async (overrides: Record<string, unknown>) => {
    const { token } = await login(ctx, freshPhone());
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload(overrides),
    });
    return { response, token };
  };

  it('never returns the exact point that was submitted', async () => {
    const { response } = await create({ location: BANEH });
    expect(response.statusCode).toBe(201);
    const body = response.json() as OrderBody;
    expect(body.location).not.toBeNull();
    expect(body.location!.approximate).toBe(true);
    expect(body.location!.precisionMeters).toBeGreaterThanOrEqual(1_000);
    expect(body.location!.lat).not.toBe(BANEH.lat);
    expect(body.location!.lng).not.toBe(BANEH.lng);
    // Snapped to a two-decimal grid.
    expect(Number.isInteger(body.location!.lat * 100)).toBe(true);
    expect(Number.isInteger(body.location!.lng * 100)).toBe(true);
  });

  it('keeps the exact value out of every listing as well', async () => {
    const { token } = await create({ location: { lat: 35.998345, lng: 45.885123 } });
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/orders/mine',
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain('35.998345');
    expect(response.body).not.toContain('45.885123');
  });

  it('rejects an order outside the coverage area', async () => {
    const { response } = await create({ location: TEHRAN });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { error: { code: string } }).error.code).toBe('ZONE_NOT_SUPPORTED');
  });

  it('rejects a zone that does not match the submitted point', async () => {
    const { response } = await create({ location: BANEH, zoneId: FAR_ZONE_ID });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { error: { code: string } }).error.code).toBe('ZONE_MISMATCH');
  });

  it('derives the zone from the point instead of trusting the client', async () => {
    const { response: created } = await create({ location: BANEH });
    const body = created.json() as OrderBody;
    const stored = await ctx.repos.orders.findById(body.id);
    expect(stored?.zoneId).toBe(await ctx.repos.zones.findByPoint(BANEH).then((z) => z!.id));
  });

  it('still accepts a zone-only order when the client has no fix', async () => {
    const payload = orderPayload();
    delete (payload as { location?: unknown }).location;
    const { token } = await login(ctx, freshPhone());
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload,
    });
    expect(response.statusCode).toBe(201);
    expect((response.json() as OrderBody).location).toBeNull();
  });
});

describe('distance and ETA (E2-03)', () => {
  const withOrder = async (options: Parameters<typeof createTestContext>[1]) => {
    const ctx = await createTestContext(undefined, options);
    const { token } = await login(ctx, '09127770022');
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload({ location: BANEH }),
    });
    const order = created.json() as OrderBody;
    const distance = (origin: { lat: number; lng: number } | null) =>
      ctx.app.inject({
        method: 'GET',
        url: `/v1/orders/${order.id}${origin ? `?lat=${origin.lat}&lng=${origin.lng}` : ''}`,
        headers: auth(token),
      });
    return { ctx, distance };
  };

  it('falls back to a straight-line estimate when no router is configured', async () => {
    const { ctx, distance } = await withOrder(undefined);
    const response = await distance({ lat: 36.0, lng: 45.9 });
    expect(response.statusCode).toBe(200);
    const body = response.json() as OrderBody;
    expect(body.distance).toBeDefined();
    expect(body.distance!.approximate).toBe(true);
    expect(body.distance!.source).toBe('straight-line');
    expect(body.distance!.distanceMeters).toBeGreaterThan(0);
    expect(body.distance!.etaMinutes).toBeGreaterThanOrEqual(1);
    await ctx.close();
  });

  it('omits the estimate when no origin is sent', async () => {
    const { ctx, distance } = await withOrder(undefined);
    const response = await distance(null);
    expect((response.json() as OrderBody).distance).toBeUndefined();
    await ctx.close();
  });

  it('swallows a broken provider and marks the answer approximate', async () => {
    const broken: RouteProvider = {
      route: async () => {
        throw new Error('provider exploded');
      },
    };
    const { ctx, distance } = await withOrder({ routeProvider: broken });
    const response = await distance({ lat: 36.0, lng: 45.9 });
    expect(response.statusCode).toBe(200);
    const body = response.json() as OrderBody;
    expect(body.distance!.approximate).toBe(true);
    expect(body.distance!.distanceMeters).toBeGreaterThan(0);
    await ctx.close();
  });

  it('ignores a slow provider instead of hanging the request', async () => {
    const slow: RouteProvider = {
      route: () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ distanceMeters: 999, durationSeconds: 60 }), 5_000);
        }),
    };
    const { ctx, distance } = await withOrder({ routeProvider: slow });
    const started = Date.now();
    const response = await distance({ lat: 36.0, lng: 45.9 });
    expect(response.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(4_000);
    expect((response.json() as OrderBody).distance!.approximate).toBe(true);
    await ctx.close();
  }, 15_000);

  it('trusts a healthy provider', async () => {
    const healthy: RouteProvider = {
      route: async () => ({ distanceMeters: 1_234, durationSeconds: 600 }),
    };
    const { ctx, distance } = await withOrder({ routeProvider: healthy });
    const response = await distance({ lat: 36.0, lng: 45.9 });
    const body = response.json() as OrderBody;
    expect(body.distance).toMatchObject({
      distanceMeters: 1_234,
      durationSeconds: 600,
      etaMinutes: 10,
      approximate: false,
      source: 'provider',
    });
    await ctx.close();
  });
});
