import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  login,
  loginAsRole,
  mintAccessToken,
  type TestContext,
} from './helpers.js';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

const refreshCall = (ctx: TestContext, refreshToken: string) =>
  ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });

describe('refresh token rotation (E1-04)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rotates the refresh token and keeps the chain alive', async () => {
    const first = await login(ctx, '09125550001');
    const rotated = await refreshCall(ctx, first.refreshToken);
    expect(rotated.statusCode).toBe(200);
    const second = rotated.json() as TokenPair;
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const me = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: auth(second.accessToken),
    });
    expect(me.statusCode).toBe(200);

    const again = await refreshCall(ctx, second.refreshToken);
    expect(again.statusCode).toBe(200);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const first = await login(ctx, '09125550002');
    const rotated = (await refreshCall(ctx, first.refreshToken)).json() as TokenPair;

    const reuse = await refreshCall(ctx, first.refreshToken);
    expect(reuse.statusCode).toBe(401);
    expect((reuse.json() as { error: { code: string } }).error.code).toBe('REFRESH_TOKEN_REUSED');

    // The attacker and the legitimate client are both locked out of this family.
    const afterTheft = await refreshCall(ctx, rotated.refreshToken);
    expect(afterTheft.statusCode).toBe(401);

    const audit = await ctx.repos.audit.list(50);
    expect(audit.some((entry) => entry.action === 'auth.refresh_reuse_detected')).toBe(true);
  });

  it('logout revokes only the current device family', async () => {
    const phone = '09125550003';
    const deviceA = await login(ctx, phone);
    const deviceB = await login(ctx, phone);

    await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      payload: { refreshToken: deviceA.refreshToken },
    });

    expect((await refreshCall(ctx, deviceA.refreshToken)).statusCode).toBe(401);
    expect((await refreshCall(ctx, deviceB.refreshToken)).statusCode).toBe(200);
  });

  it('logout-all revokes every family of the user', async () => {
    const phone = '09125550004';
    const deviceA = await login(ctx, phone);
    const deviceB = await login(ctx, phone);

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/logout-all',
      headers: auth(deviceA.accessToken),
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as { revoked: number }).revoked).toBeGreaterThanOrEqual(2);

    expect((await refreshCall(ctx, deviceA.refreshToken)).statusCode).toBe(401);
    expect((await refreshCall(ctx, deviceB.refreshToken)).statusCode).toBe(401);
  });

  it('registers the device and lists it for the user', async () => {
    const phone = '09125550005';
    await ctx.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
    const code = ctx.sms.lastCodeFor(phone);
    const verified = await ctx.app.inject({
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: {
        phone,
        code,
        device: { platform: 'android', deviceId: 'device-abc-123', appVersion: '1.0.0' },
      },
    });
    const body = verified.json() as { accessToken: string; deviceId: string | null };
    expect(body.deviceId).not.toBeNull();

    const devices = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/devices',
      headers: auth(body.accessToken),
    });
    const list = devices.json() as { items: { deviceId: string; platform: string }[] };
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ deviceId: 'device-abc-123', platform: 'android' });
  });

  it('applies a role change immediately, without waiting for the token to expire', async () => {
    const { token, userId } = await loginAsRole(ctx, '09125550006', 'USER');
    const denied = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/settings',
      headers: auth(token),
    });
    expect(denied.statusCode).toBe(403);

    const user = (await ctx.repos.users.findById(userId))!;
    await ctx.repos.users.save({ ...user, role: 'ADMIN' });

    // Same token, new role: the guard reads the user, not just the claims.
    const allowed = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/settings',
      headers: auth(token),
    });
    expect(allowed.statusCode).toBe(200);
  });

  it('rejects an access token whose user was suspended', async () => {
    const { token, userId } = await loginAsRole(ctx, '09125550007', 'USER');
    const user = (await ctx.repos.users.findById(userId))!;
    await ctx.repos.users.save({ ...user, status: 'SUSPENDED' });

    const response = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth(token) });
    expect(response.statusCode).toBe(403);
    expect((response.json() as { error: { code: string } }).error.code).toBe('ACCOUNT_SUSPENDED');
    expect(mintAccessToken({ id: userId, role: 'USER' }).split('.')).toHaveLength(3);
  });
});
