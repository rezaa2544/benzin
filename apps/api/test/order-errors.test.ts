import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestContext, login, orderPayload, type TestContext } from './helpers.js';

/**
 * E3-02: every rejection of «ایجاد سفارش» carries a stable code, so clients can render
 * Persian copy without parsing English messages.
 */
describe('create order error contract (E3-02)', () => {
  let ctx: TestContext;
  let token: string;
  let phone = 130_000_000;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const freshToken = async () => {
    const session = await login(ctx, `09${(phone += 1)}`);
    return session.token;
  };

  const post = async (payload: unknown, as = token) =>
    ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: as ? auth(as) : {},
      payload: payload as Record<string, unknown>,
    });

  const code = (response: { json: () => unknown }) =>
    (response.json() as { error: { code: string } }).error.code;

  it('rejects anonymous callers with UNAUTHORIZED', async () => {
    token = await freshToken();
    const response = await post(orderPayload(), '');
    expect(response.statusCode).toBe(401);
    expect(code(response)).toBe('UNAUTHORIZED');
  });

  it('rejects a malformed body with VALIDATION_ERROR and field details', async () => {
    const response = await post({ ...orderPayload(), side: 'RENT' });
    expect(response.statusCode).toBe(422);
    expect(code(response)).toBe('VALIDATION_ERROR');
    expect((response.json() as { error: { details: unknown } }).error.details).toBeTruthy();
  });

  it('rejects litres outside the configured range', async () => {
    const response = await post(orderPayload({ litres: 500 }));
    expect(response.statusCode).toBe(422);
    expect(code(response)).toBe('VALIDATION_ERROR');
  });

  it('rejects a price above the official rate', async () => {
    const response = await post(orderPayload({ rateToman: 9_999 }));
    expect(response.statusCode).toBe(422);
    const body = response.json() as {
      error: { code: string; details: { officialRateToman: number } };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.officialRateToman).toBe(3_000);
  });

  it('rejects an unknown zone', async () => {
    const payload = orderPayload({ zoneId: '0b9c1c3e-5f7a-4d2b-9e8f-1234567890ab' });
    delete (payload as { location?: unknown }).location;
    const response = await post(payload);
    expect(response.statusCode).toBe(422);
    expect(code(response)).toBe('ZONE_NOT_SUPPORTED');
  });

  it('rejects a point outside the coverage area', async () => {
    const response = await post(orderPayload({ location: { lat: 35.6997, lng: 51.338 } }));
    expect(response.statusCode).toBe(422);
    expect(code(response)).toBe('ZONE_NOT_SUPPORTED');
  });

  it('rejects a point that contradicts the chosen zone', async () => {
    const response = await post(orderPayload({ zoneId: '0b9c1c3e-5f7a-4d2b-9e8f-1234567890ab' }));
    expect(response.statusCode).toBe(422);
    expect(code(response)).toBe('ZONE_MISMATCH');
  });

  it('rejects the third open order with ORDER_LIMIT_REACHED', async () => {
    const as = await freshToken();
    expect((await post(orderPayload(), as)).statusCode).toBe(201);
    expect((await post(orderPayload(), as)).statusCode).toBe(201);
    const third = await post(orderPayload(), as);
    expect(third.statusCode).toBe(429);
    expect(code(third)).toBe('ORDER_LIMIT_REACHED');
  });
});
