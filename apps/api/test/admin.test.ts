import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  freshPhone,
  login,
  loginAsRole,
  startTrade,
  ZONE_ID,
  type TestContext,
} from './helpers.js';

const json = <T>(response: { json: () => unknown }): T => response.json() as T;

interface UserRow {
  id: string;
  phone: string;
  role: string;
  status: string;
  roleFa: string;
  suspendedUntil: string | null;
}

describe('admin back-office API (E8)', () => {
  let ctx: TestContext;
  let ownerToken: string;
  let adminToken: string;
  let supportToken: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    ownerToken = (await loginAsRole(ctx, freshPhone(), 'OWNER')).token;
    adminToken = (await loginAsRole(ctx, freshPhone(), 'ADMIN')).token;
    supportToken = (await loginAsRole(ctx, freshPhone(), 'SUPPORT')).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('lists and filters users, hiding nothing but paging predictably', async () => {
    const victimPhone = freshPhone();
    const victim = await login(ctx, victimPhone);

    const all = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/users?limit=50',
      headers: auth(adminToken),
    });
    expect(all.statusCode).toBe(200);
    const page = json<{ items: UserRow[]; total: number; limit: number }>(all);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.total).toBeGreaterThanOrEqual(page.items.length);

    const filtered = await ctx.app.inject({
      method: 'GET',
      url: `/v1/admin/users?q=${victimPhone}`,
      headers: auth(adminToken),
    });
    const matches = json<{ items: UserRow[] }>(filtered).items;
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe(victim.userId);
    expect(matches[0]?.roleFa).toBe('کاربر');

    const onlySupport = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/users?role=SUPPORT',
      headers: auth(adminToken),
    });
    expect(
      json<{ items: UserRow[] }>(onlySupport).items.every((row) => row.role === 'SUPPORT'),
    ).toBe(true);

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/admin/users/${victim.userId}`,
      headers: auth(adminToken),
    });
    expect(detail.statusCode).toBe(200);
    const profile = json<{
      counts: { orders: number };
      reputation: { score: number; levelFa: string };
    }>(detail);
    expect(profile.counts.orders).toBe(0);
    expect(profile.reputation.score).toBe(50);
    expect(profile.reputation.levelFa).toBe('نقره‌ای');

    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/users/11111111-1111-4111-8111-111111111111',
      headers: auth(adminToken),
    });
    expect(missing.statusCode).toBe(404);
    expect(json<{ error: { code: string } }>(missing).error.code).toBe('USER_NOT_FOUND');
  });

  it('promotes, suspends and restores a user with audit rows and notifications', async () => {
    const phone = freshPhone();
    const user = await login(ctx, phone);

    const promoted = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${user.userId}`,
      headers: auth(ownerToken),
      payload: { role: 'SUPPORT', reason: 'تیم پشتیبانی بانه' },
    });
    expect(promoted.statusCode).toBe(200);
    expect(json<UserRow>(promoted).role).toBe('SUPPORT');
    expect(json<UserRow>(promoted).roleFa).toBe('پشتیبانی');

    const inbox = await ctx.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: auth(user.token),
    });
    expect(
      json<{ items: { kind: string; bodyFa: string }[] }>(inbox).items.some(
        (item) => item.kind === 'ACCOUNT_ROLE_CHANGED' && item.bodyFa.includes('پشتیبانی'),
      ),
    ).toBe(true);

    const suspended = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${user.userId}`,
      headers: auth(adminToken),
      payload: { status: 'SUSPENDED', suspendHours: 48, reason: 'گزارش تخلف تأییدشده' },
    });
    expect(suspended.statusCode).toBe(200);
    const suspendedRow = json<UserRow>(suspended);
    expect(suspendedRow.status).toBe('SUSPENDED');
    expect(suspendedRow.suspendedUntil).not.toBeNull();
    const hoursLeft =
      (new Date(suspendedRow.suspendedUntil ?? 0).getTime() - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(47);
    expect(hoursLeft).toBeLessThanOrEqual(48);

    // Suspended accounts cannot read the inbox, so the notification is asserted at the store.
    const inboxRows = await ctx.repos.notifications.listByUser(user.userId, {
      limit: 20,
      unreadOnly: false,
    });
    expect(inboxRows.some((item) => item.kind === 'ACCOUNT_SUSPENDED')).toBe(true);

    const blocked = await ctx.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: auth(user.token),
    });
    expect(blocked.statusCode).toBe(403);
    expect(json<{ error: { code: string } }>(blocked).error.code).toBe('ACCOUNT_SUSPENDED');

    const restored = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${user.userId}`,
      headers: auth(ownerToken),
      payload: { status: 'ACTIVE' },
    });
    expect(restored.statusCode).toBe(200);
    expect(json<UserRow>(restored).suspendedUntil).toBeNull();

    const audit = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/audit?action=user.updated&limit=20',
      headers: auth(adminToken),
    });
    const actions = json<{ items: { action: string; entityId: string }[] }>(audit).items.filter(
      (row) => row.entityId === user.userId,
    );
    expect(actions).toHaveLength(3);

    const missingHours = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${user.userId}`,
      headers: auth(adminToken),
      payload: { status: 'SUSPENDED' },
    });
    expect(missingHours.statusCode).toBe(422);
  });

  it('keeps owners out of reach of plain admins', async () => {
    const protectedOwner = await loginAsRole(ctx, freshPhone(), 'OWNER');
    const attempt = await ctx.app.inject({
      method: 'PATCH',
      url: `/v1/admin/users/${protectedOwner.userId}`,
      headers: auth(adminToken),
      payload: { role: 'USER' },
    });
    expect(attempt.statusCode).toBe(403);
  });

  it('resolves a disputed trade and notifies both parties', async () => {
    const trade = await startTrade(ctx);
    const dispute = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/dispute`,
      headers: auth(trade.owner.token),
      payload: { reason: 'خریدار کارت را تحویل نگرفت' },
    });
    expect(dispute.statusCode).toBe(200);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/orders?status=DISPUTED',
      headers: auth(adminToken),
    });
    expect(list.statusCode).toBe(200);
    const rows = json<{ items: { id: string; ownerPhone: string | null }[] }>(list).items;
    expect(rows.some((row) => row.id === trade.orderId)).toBe(true);

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/v1/admin/orders/${trade.orderId}`,
      headers: auth(adminToken),
    });
    const order = json<{ reservations: { id: string; takerPhone: string | null }[] }>(detail);
    expect(order.reservations[0]?.id).toBe(trade.reservationId);
    expect(order.reservations[0]?.takerPhone).toBe(trade.taker.phone);

    const resolved = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${trade.orderId}/resolve`,
      headers: auth(adminToken),
      payload: { outcome: 'COMPLETE', note: 'هر دو طرف تحویل را تأیید کردند' },
    });
    expect(resolved.statusCode).toBe(200);
    const resolvedOrder = json<{ status: string; reservations: { status: string }[] }>(resolved);
    expect(resolvedOrder.status).toBe('COMPLETED');
    expect(resolvedOrder.reservations[0]?.status).toBe('COMPLETED');

    for (const party of [trade.owner, trade.taker]) {
      const inbox = await ctx.app.inject({
        method: 'GET',
        url: '/v1/notifications',
        headers: auth(party.token),
      });
      expect(
        json<{ items: { kind: string }[] }>(inbox).items.some(
          (item) => item.kind === 'DISPUTE_RESOLVED',
        ),
      ).toBe(true);
    }

    const again = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/orders/${trade.orderId}/resolve`,
      headers: auth(adminToken),
      payload: { outcome: 'CANCEL', note: 'تلاش دوم' },
    });
    expect(again.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(again).error.code).toBe('DISPUTE_NOT_OPEN');
  });

  it('lists subscriptions for support review', async () => {
    const buyer = await login(ctx, freshPhone());
    const purchase = await ctx.app.inject({
      method: 'POST',
      url: '/v1/subscriptions',
      headers: auth(buyer.token),
      payload: { planCode: 'monthly', method: 'CARD_TO_CARD' },
    });
    expect(purchase.statusCode).toBe(201);
    const paymentId = json<{ id: string }>(purchase).id;
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/payments/${paymentId}/confirm`,
      headers: auth(adminToken),
      payload: {},
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/subscriptions?status=ACTIVE',
      headers: auth(adminToken),
    });
    expect(list.statusCode).toBe(200);
    const rows = json<{
      items: { userId: string; planCode: string | null; phone: string | null; status: string }[];
    }>(list).items;
    const row = rows.find((item) => item.userId === buyer.userId);
    expect(row?.planCode).toBe('monthly');
    expect(row?.status).toBe('ACTIVE');
    expect(row?.phone).toBeTruthy();
  });

  it('summarises the platform for the dashboard and status screens', async () => {
    const dashboard = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/dashboard',
      headers: auth(adminToken),
    });
    expect(dashboard.statusCode).toBe(200);
    const data = json<{
      users: { total: number; active: number };
      orders: { byStatus: Record<string, number> };
      tiles: { labelFa: string; value: string; hintFa: string }[];
    }>(dashboard);
    expect(data.users.total).toBeGreaterThanOrEqual(data.users.active);
    expect(data.orders.byStatus.COMPLETED).toBeGreaterThanOrEqual(1);
    expect(data.tiles).toHaveLength(6);
    expect(data.tiles[2]?.value).toContain('تومان');
    // Persian digits only in the money tile, never a latin "49,000".
    expect(data.tiles[2]?.value).not.toMatch(/[0-9]{3},[0-9]{3}/);

    const status = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/status',
      headers: auth(adminToken),
    });
    expect(status.statusCode).toBe(200);
    const health = json<{
      mode: string;
      version: string;
      checks: { name: string; ok: boolean; detailFa: string }[];
      providers: { kind: string; provider: string }[];
    }>(status);
    expect(health.mode).toBe('memory');
    expect(health.version).toBe('0.1.0');
    expect(health.checks.find((check) => check.name === 'zones')?.ok).toBe(true);
    expect(health.providers.map((provider) => provider.provider)).toContain('console');
  });

  it('manages provider credentials without ever echoing a secret', async () => {
    const saved = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/providers',
      headers: auth(ownerToken),
      payload: {
        provider: 'kavenegar',
        kind: 'SMS',
        isActive: true,
        config: { apiKey: 'super-secret-key', sender: '10008445' },
      },
    });
    expect(saved.statusCode).toBe(200);
    const provider = json<{ config: Record<string, unknown>; isActive: boolean }>(saved);
    expect(provider.config.apiKey).toBe('••••');
    expect(provider.config.sender).toBe('10008445');
    expect(provider.isActive).toBe(true);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/providers',
      headers: auth(adminToken),
    });
    const items = json<{ items: { provider: string; config: Record<string, unknown> }[] }>(
      list,
    ).items;
    expect(items.map((item) => item.provider)).toEqual(
      expect.arrayContaining(['console', 'sandbox', 'kavenegar']),
    );
    expect(JSON.stringify(items)).not.toContain('super-secret-key');

    // Re-saving the masked value keeps the stored secret instead of overwriting it.
    await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/providers',
      headers: auth(ownerToken),
      payload: {
        provider: 'kavenegar',
        kind: 'SMS',
        isActive: true,
        config: { apiKey: '••••', sender: '10008445' },
      },
    });
    const stored = await ctx.repos.providerSettings.findBy('SMS', 'kavenegar');
    expect(stored?.config.apiKey).toBe('super-secret-key');

    const tested = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/providers/SMS/kavenegar/test',
      headers: auth(ownerToken),
      payload: { phone: '09121112233' },
    });
    expect(tested.statusCode).toBe(200);
    expect(ctx.sms.messages.at(-1)).toMatchObject({ phone: '09121112233' });

    const unknown = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/providers/SMS/nope/test',
      headers: auth(ownerToken),
      payload: { phone: '09121112233' },
    });
    expect(unknown.statusCode).toBe(404);

    const disabled = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/providers/PAYMENT/zarinpal/test',
      headers: auth(ownerToken),
      payload: { phone: '09121112233' },
    });
    expect(disabled.statusCode).toBe(409);
  });

  it('creates or updates a city from the panel', async () => {
    const created = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/zones',
      headers: auth(ownerToken),
      payload: {
        slug: 'sanandaj',
        nameFa: 'سنندج',
        city: 'سنندج',
        province: 'کردستان',
        isActive: true,
        boundary: [
          [46.98, 35.29],
          [47.02, 35.29],
          [47.02, 35.33],
          [46.98, 35.33],
        ],
      },
    });
    expect(created.statusCode).toBe(200);
    const zone = json<{ id: string; slug: string; isActive: boolean }>(created);
    expect(zone.slug).toBe('sanandaj');
    expect(zone.isActive).toBe(true);

    const deactivated = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/zones',
      headers: auth(ownerToken),
      payload: {
        slug: 'sanandaj',
        nameFa: 'سنندج',
        city: 'سنندج',
        province: 'کردستان',
        isActive: false,
        boundary: [
          [46.98, 35.29],
          [47.02, 35.29],
          [47.02, 35.33],
        ],
      },
    });
    expect(deactivated.statusCode).toBe(200);
    expect(json<{ id: string }>(deactivated).id).toBe(zone.id);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/zones',
      headers: auth(adminToken),
    });
    const zones = json<{ items: { slug: string; isActive: boolean; vertices: number }[] }>(
      list,
    ).items;
    expect(zones.find((row) => row.slug === 'baneh')?.isActive).toBe(true);
    expect(zones.find((row) => row.slug === 'sanandaj')?.isActive).toBe(false);

    const tiny = await ctx.app.inject({
      method: 'PUT',
      url: '/v1/admin/zones',
      headers: auth(ownerToken),
      payload: {
        slug: 'tiny',
        nameFa: 'کوچک',
        city: 'کوچک',
        province: 'کردستان',
        isActive: true,
        boundary: [
          [46.9, 35.2],
          [47, 35.2],
        ],
      },
    });
    expect(tiny.statusCode).toBe(422);
  });

  it('runs reconciliation from the panel', async () => {
    const report = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/reconciliation',
      headers: auth(ownerToken),
    });
    expect(report.statusCode).toBe(200);
    expect(json<{ expiredPayments: number }>(report).expiredPayments).toBeGreaterThanOrEqual(0);
  });

  it('refuses every admin route to support staff and users', async () => {
    const user = await login(ctx, freshPhone());
    const routes: [string, string][] = [
      ['GET', '/v1/admin/users'],
      ['GET', '/v1/admin/orders'],
      ['GET', '/v1/admin/subscriptions'],
      ['GET', '/v1/admin/dashboard'],
      ['GET', '/v1/admin/status'],
      ['GET', '/v1/admin/providers'],
      ['GET', '/v1/admin/zones'],
      ['GET', '/v1/admin/audit'],
    ];
    for (const [method, url] of routes) {
      const asUser = await ctx.app.inject({ method, url, headers: auth(user.token) } as never);
      expect(asUser.statusCode).toBe(403);
      const asSupport = await ctx.app.inject({
        method,
        url,
        headers: auth(supportToken),
      } as never);
      expect(asSupport.statusCode).toBe(403);
    }

    const settingsPatch = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: auth(supportToken),
      payload: { 'otp.max_attempts': 4 },
    });
    expect(settingsPatch.statusCode).toBe(403);
  });

  it('creates the owner account idempotently', async () => {
    const phone = freshPhone();
    const first = await ctx.services.admin.createOwner(phone, 'مالک بنزین');
    expect(first.role).toBe('OWNER');
    expect(first.displayName).toBe('مالک بنزین');

    const second = await ctx.services.admin.createOwner(phone, 'مالک بنزین');
    expect(second.id).toBe(first.id);

    const takenPhone = freshPhone();
    await login(ctx, takenPhone);
    await expect(ctx.services.admin.createOwner(takenPhone, 'x')).rejects.toThrow(/another role/);
  });

  it('filters the audit log by entity and actor', async () => {
    const filtered = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/audit?entity=zone&limit=10',
      headers: auth(adminToken),
    });
    expect(filtered.statusCode).toBe(200);
    const page = json<{ items: { entity: string }[]; total: number }>(filtered);
    expect(page.items.every((row) => row.entity === 'zone')).toBe(true);
    expect(page.total).toBeGreaterThanOrEqual(2);

    const byActor = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/audit?entity=zone&actorId=11111111-1111-4111-8111-111111111111',
      headers: auth(adminToken),
    });
    expect(json<{ total: number }>(byActor).total).toBe(0);
  });

  it('shows the seeded city as active coverage', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/zones',
      headers: auth(adminToken),
    });
    const zones = json<{ items: { id: string; isActive: boolean }[] }>(response).items;
    expect(zones.some((zone) => zone.id === ZONE_ID && zone.isActive)).toBe(true);
  });
});
