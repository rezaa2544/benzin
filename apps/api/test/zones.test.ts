import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestContext, login, orderPayload, type TestContext } from './helpers.js';

describe('zones (E2-01)', () => {
  let ctx: TestContext;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    ({ token } = await login(ctx, '09127770001'));
  });

  afterAll(async () => {
    await ctx.close();
  });

  const locate = (lat: number, lng: number) =>
    ctx.app.inject({
      method: 'GET',
      url: `/v1/zones/locate?lat=${lat}&lng=${lng}`,
      headers: auth(token),
    });

  it('answers "which city is this point in?"', async () => {
    const response = await locate(35.998, 45.885);
    expect(response.statusCode).toBe(200);
    const body = response.json() as { supported: boolean; zone: { slug: string; nameFa: string } };
    expect(body.supported).toBe(true);
    expect(body.zone).toMatchObject({ slug: 'baneh', nameFa: 'بانه' });
  });

  it('reports unsupported coverage instead of failing', async () => {
    const response = await locate(35.6892, 51.389);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ supported: false, zone: null });
  });

  it('validates the coordinates', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/zones/locate?lat=999&lng=45',
      headers: auth(token),
    });
    expect(response.statusCode).toBe(422);
  });

  it('requires authentication', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/zones/locate?lat=35.99&lng=45.88',
    });
    expect(response.statusCode).toBe(401);
  });

  it('lists the active zones', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/zones',
      headers: auth(token),
    });
    const body = response.json() as { items: { slug: string }[] };
    expect(body.items.map((zone) => zone.slug)).toContain('baneh');
  });

  it('refuses an order in a zone that is not served', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload({ zoneId: '0b9c1c3e-5f7a-4d2b-9e8f-1234567890ab' }),
    });
    expect(response.statusCode).toBe(422);
    expect((response.json() as { error: { code: string } }).error.code).toBe('ZONE_NOT_SUPPORTED');
  });

  it('accepts an order inside the seeded zone', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(token),
      payload: orderPayload(),
    });
    expect(response.statusCode).toBe(201);
  });
});
