import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  freshPhone,
  login,
  loginAsRole,
  ManualClock,
  orderPayload,
  startTrade,
  type TestContext,
} from './helpers.js';

const json = <T>(response: { json: () => unknown }): T => response.json() as T;

interface InboxItem {
  id: string;
  kind: string;
  channel: string;
  titleFa: string;
  bodyFa: string;
  readAt: string | null;
}

const inbox = async (ctx: TestContext, token: string, query = ''): Promise<InboxItem[]> => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: `/v1/notifications${query}`,
    headers: auth(token),
  });
  expect(response.statusCode).toBe(200);
  return json<{ items: InboxItem[] }>(response).items;
};

describe('notifications', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('tells the owner about a new reservation request in Persian', async () => {
    const trade = await startTrade(ctx, { confirm: false });

    const items = await inbox(ctx, trade.owner.token);
    const request = items.find((item) => item.kind === 'RESERVATION_REQUESTED');
    expect(request).toBeTruthy();
    expect(request?.channel).toBe('IN_APP');
    expect(request?.titleFa).toBe('درخواست رزرو جدید');
    expect(request?.bodyFa).toContain('۲۰ لیتر');
    expect(request?.bodyFa).toContain('۵ دقیقه');
    expect(request?.readAt).toBeNull();
    expect(request?.bodyFa).toMatch(/[\u0600-\u06FF]/);
  });

  it('notifies the taker on acceptance and sends the SMS variant', async () => {
    const trade = await startTrade(ctx);

    const items = await inbox(ctx, trade.taker.token);
    const confirmed = items.find((item) => item.kind === 'RESERVATION_CONFIRMED');
    expect(confirmed?.bodyFa).toContain('تأیید کرد');

    const sms = ctx.sms.messages.filter((message) => message.phone === trade.taker.phone);
    expect(sms.some((message) => message.message === 'رزرو شما تأیید شد. بنزین')).toBe(true);

    const audit = await ctx.repos.audit.list(50);
    expect(audit.some((row) => row.action === 'notification.sms_sent')).toBe(true);
  });

  it('notifies the taker when the owner rejects', async () => {
    const trade = await startTrade(ctx, { confirm: false });

    const rejected = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/reject`,
      headers: auth(trade.owner.token),
    });
    expect(rejected.statusCode).toBe(200);

    const items = await inbox(ctx, trade.taker.token);
    const notification = items.find((item) => item.kind === 'RESERVATION_REJECTED');
    expect(notification?.bodyFa).toContain('رد کرد');
    expect(
      ctx.sms.messages.some(
        (message) =>
          message.phone === trade.taker.phone &&
          message.message === 'درخواست رزرو شما رد شد. بنزین',
      ),
    ).toBe(true);
  });

  it('tracks unread counts and read state per user', async () => {
    const trade = await startTrade(ctx, { confirm: false });

    const count = await ctx.app.inject({
      method: 'GET',
      url: '/v1/notifications/unread-count',
      headers: auth(trade.owner.token),
    });
    expect(count.statusCode).toBe(200);
    expect(json<{ unreadCount: number }>(count).unreadCount).toBe(1);

    const [first] = await inbox(ctx, trade.owner.token);
    if (!first) throw new Error('expected one notification');

    const read = await ctx.app.inject({
      method: 'POST',
      url: `/v1/notifications/${first.id}/read`,
      headers: auth(trade.owner.token),
    });
    expect(read.statusCode).toBe(200);
    expect(json<{ readAt: string | null }>(read).readAt).not.toBeNull();

    const afterRead = await ctx.app.inject({
      method: 'GET',
      url: '/v1/notifications/unread-count',
      headers: auth(trade.owner.token),
    });
    expect(json<{ unreadCount: number }>(afterRead).unreadCount).toBe(0);

    const unreadOnly = await inbox(ctx, trade.owner.token, '?unreadOnly=true');
    expect(unreadOnly).toHaveLength(0);

    // A stranger cannot touch someone else's notification.
    const outsider = (await login(ctx, freshPhone())).token;
    const cross = await ctx.app.inject({
      method: 'POST',
      url: `/v1/notifications/${first.id}/read`,
      headers: auth(outsider),
    });
    expect(cross.statusCode).toBe(404);
    expect(json<{ error: { code: string } }>(cross).error.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  it('marks everything as read for one user only', async () => {
    const trade = await startTrade(ctx, { confirm: false });

    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/notifications/read-all',
      headers: auth(trade.owner.token),
    });
    expect(response.statusCode).toBe(200);
    expect(json<{ read: number; unreadCount: number }>(response)).toEqual({
      read: 1,
      unreadCount: 0,
    });

    const takerInbox = await inbox(ctx, trade.taker.token);
    expect(takerInbox).toHaveLength(0);
  });

  it('informs the other party when a trade completes', async () => {
    const trade = await startTrade(ctx);

    const completed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/complete`,
      headers: auth(trade.taker.token),
    });
    expect(completed.statusCode).toBe(200);

    const ownerItems = await inbox(ctx, trade.owner.token);
    const ownerTrade = ownerItems.find((item) => item.kind === 'TRADE_COMPLETED');
    expect(ownerTrade?.bodyFa).toContain('۲٬۶۰۰ تومان');

    // The taker closed the trade themselves, so they are not told about their own action.
    const takerItems = await inbox(ctx, trade.taker.token);
    expect(takerItems.some((item) => item.kind === 'TRADE_COMPLETED')).toBe(false);
  });

  it('hides SMS delivery when the operator turns it off', async () => {
    const admin = await loginAsRole(ctx, freshPhone(), 'ADMIN');
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: auth(admin.token),
      payload: { 'notification.sms_enabled': false },
    });
    try {
      const trade = await startTrade(ctx);
      const items = await inbox(ctx, trade.taker.token);
      expect(items.some((item) => item.kind === 'RESERVATION_CONFIRMED')).toBe(true);
      expect(
        ctx.sms.messages.some(
          (message) =>
            message.phone === trade.taker.phone && message.message === 'رزرو شما تأیید شد. بنزین',
        ),
      ).toBe(false);
    } finally {
      await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/admin/settings',
        headers: auth(admin.token),
        payload: { 'notification.sms_enabled': true },
      });
    }
  });
});

describe('scheduled notifications', () => {
  let ctx: TestContext;
  const clock = new ManualClock();

  beforeAll(async () => {
    ctx = await createTestContext(clock);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('warns the taker when their request expires unanswered', async () => {
    const trade = await startTrade(ctx, { confirm: false });
    clock.advanceMinutes(11);

    const expired = await ctx.services.reservations.expireDueReservations();
    expect(expired).toBeGreaterThanOrEqual(1);

    const items = await inbox(ctx, trade.taker.token);
    const notification = items.find((item) => item.kind === 'RESERVATION_EXPIRED');
    expect(notification?.bodyFa).toContain('منقضی');
    expect(notification?.bodyFa).toContain('۵ دقیقه');
  });

  it('tells both parties when an abandoned trade auto-completes', async () => {
    const trade = await startTrade(ctx);
    clock.advanceHours(3);

    // Access tokens live 15 minutes, so the jumped clock requires a fresh login.
    const owner = (await login(ctx, trade.owner.phone)).token;
    const taker = (await login(ctx, trade.taker.phone)).token;

    expect(await ctx.services.reservations.autoCompleteDueTrades()).toBeGreaterThanOrEqual(1);

    for (const token of [owner, taker]) {
      const items = await inbox(ctx, token);
      const notification = items.find((item) => item.kind === 'TRADE_AUTO_COMPLETED');
      expect(notification?.bodyFa).toContain('خودکار تکمیل شد');
      expect(notification?.bodyFa).toContain('۲ ساعت');
    }
  });

  it('tells the owner when their listing expires unsold', async () => {
    const ownerPhone = freshPhone();
    const owner = (await login(ctx, ownerPhone)).token;
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(owner),
      payload: orderPayload({ note: 'سفارش منقضی' }),
    });
    expect(created.statusCode).toBe(201);
    const orderId = (created.json() as { id: string }).id;

    clock.advanceHours(48);
    const freshOwner = (await login(ctx, ownerPhone)).token;
    expect(await ctx.services.orders.expireDueOrders()).toBeGreaterThanOrEqual(1);

    const items = await inbox(ctx, freshOwner);
    const notification = items.find((item) => item.kind === 'ORDER_EXPIRED');
    expect(notification?.titleFa).toBe('سفارش منقضی شد');
    const stored = await ctx.repos.orders.findById(orderId);
    expect(stored?.status).toBe('EXPIRED');
  });
});
