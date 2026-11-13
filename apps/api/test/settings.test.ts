import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@benzin/shared';
import { auth, createTestContext, login, loginAsRole, type TestContext } from './helpers.js';

describe('admin settings', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('serves the compiled-in defaults', async () => {
    const { token } = await loginAsRole(ctx, '09129000001', 'ADMIN');
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/settings',
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { settings: Record<string, unknown> };
    expect(body.settings['order.min_litres']).toBe(DEFAULT_SETTINGS['order.min_litres']);
  });

  it('denies regular users', async () => {
    const { token } = await login(ctx, '09129000002');
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/settings',
      headers: auth(token),
    });
    expect(response.statusCode).toBe(403);
  });

  it('updates a value, validates it and audits the change', async () => {
    const { token, userId } = await loginAsRole(ctx, '09129000003', 'OWNER');

    const ok = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: auth(token),
      payload: { 'order.max_open_per_user': 4 },
    });
    expect(ok.statusCode).toBe(200);

    const applied = await ctx.app.inject({
      method: 'GET',
      url: '/v1/meta/config',
      headers: auth(token),
    });
    expect((applied.json() as { maxActiveReservations: number }).maxActiveReservations).toBe(
      DEFAULT_SETTINGS['reservation.max_active_per_user'],
    );

    const invalid = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: auth(token),
      payload: { 'order.max_open_per_user': 99 },
    });
    expect(invalid.statusCode).toBe(422);

    const unknown = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: auth(token),
      payload: { 'not.a.setting': 1 },
    });
    expect(unknown.statusCode).toBe(422);

    const audit = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/audit',
      headers: auth(token),
    });
    const entries = (audit.json() as { items: { actorId: string; action: string }[] }).items;
    expect(
      entries.some((entry) => entry.action === 'settings.updated' && entry.actorId === userId),
    ).toBe(true);
  });
});
