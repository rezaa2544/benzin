import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, createTestContext, login, type TestContext } from './helpers.js';

describe('authentication', () => {
  let ctx: TestContext;
  const phone = '09121234567';

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('sends a five digit code and issues a session', async () => {
    const requested = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: '+98 912 123 4567' },
    });
    expect(requested.statusCode).toBe(202);
    expect(ctx.sms.lastCodeFor(phone)).toMatch(/^\d{5}$/);

    const verified = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone, code: ctx.sms.lastCodeFor(phone) },
    });
    expect(verified.statusCode).toBe(200);
    const body = verified.json() as {
      accessToken: string;
      refreshToken: string;
      isNewUser: boolean;
      user: { phone: string };
    };
    expect(body.isNewUser).toBe(true);
    expect(body.user.phone).toBe(phone);
    expect(body.accessToken.split('.')).toHaveLength(3);
    expect(body.refreshToken.length).toBeGreaterThan(20);
  });

  it('rejects a wrong code and lowers the remaining attempts', async () => {
    const other = '09121111111';
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: other },
    });
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: { phone: other, code: '00000' },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json() as {
      error: { code: string; details: { remainingAttempts: number } };
    };
    expect(body.error.code).toBe('OTP_INVALID');
    expect(body.error.details.remainingAttempts).toBe(4);
  });

  it('rate limits a second code inside the cooldown window', async () => {
    const limited = '09122222222';
    await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: limited },
    });
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: limited },
    });
    expect(again.statusCode).toBe(429);
    expect((again.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });

  it('requires a bearer token on protected routes', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
  });

  it('returns the profile and revokes the refresh family on logout', async () => {
    const { accessToken, refreshToken } = await login(ctx, '09123333333');
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth(accessToken) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { phone: string }).phone).toBe('09123333333');

    const loggedOut = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken },
    });
    expect(loggedOut.statusCode).toBe(204);

    // Access tokens are short-lived by design; the refresh token dies immediately.
    const after = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    });
    expect(after.statusCode).toBe(401);
    expect((after.json() as { error: { code: string } }).error.code).toBe('REFRESH_TOKEN_INVALID');
  });

  it('rejects invalid phone numbers with field details', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: '02112345678' },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json() as { error: { code: string; details: Record<string, string> } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.phone).toBe('PHONE_INVALID');
  });
});
