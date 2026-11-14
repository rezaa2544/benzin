import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  freshPhone,
  login,
  loginAsRole,
  startTrade,
  type TestContext,
  type TradeSetup,
} from './helpers.js';

const json = <T>(response: { json: () => unknown }): T => response.json() as T;

describe('chat', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const send = async (
    trade: TradeSetup,
    actor: 'owner' | 'taker' | string,
    body: string,
    clientMessageId?: string,
  ) => {
    const token =
      actor === 'owner' ? trade.owner.token : actor === 'taker' ? trade.taker.token : actor;
    return ctx.app.inject({
      method: 'POST',
      url: `/v1/conversations/${trade.conversationId}/messages`,
      headers: auth(token),
      payload: clientMessageId ? { body, clientMessageId } : { body },
    });
  };

  it('opens a single thread shared by the order owner and the taker', async () => {
    const trade = await startTrade(ctx);

    const takerView = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders/${trade.orderId}/conversation`,
      headers: auth(trade.taker.token),
    });
    expect(takerView.statusCode).toBe(200);
    const view = json<{
      id: string;
      orderId: string;
      party: unknown;
      peer: { id: string };
      contactAllowed: boolean;
      writable: boolean;
    }>(takerView);
    expect(view.id).toBe(trade.conversationId);
    expect(view.orderId).toBe(trade.orderId);
    expect(view.peer.id).toBe(trade.owner.userId);
    expect(view.writable).toBe(true);
    expect(view.contactAllowed).toBe(true);
    // The thread itself never leaks the peer's phone number (E4-05 owns that reveal).
    expect(JSON.stringify(view)).not.toContain(trade.owner.phone);
  });

  it('keeps strangers out of the thread', async () => {
    const trade = await startTrade(ctx);
    const outsider = (await login(ctx, freshPhone())).token;

    const open = await ctx.app.inject({
      method: 'GET',
      url: `/v1/orders/${trade.orderId}/conversation`,
      headers: auth(outsider),
    });
    expect(open.statusCode).toBe(403);
    expect(json<{ error: { code: string } }>(open).error.code).toBe('NOT_CONVERSATION_PARTY');

    const read = await ctx.app.inject({
      method: 'GET',
      url: `/v1/conversations/${trade.conversationId}/messages`,
      headers: auth(outsider),
    });
    expect(read.statusCode).toBe(403);

    const write = await send(trade, outsider, 'سلام');
    expect(write.statusCode).toBe(403);
    expect(json<{ error: { code: string } }>(write).error.code).toBe('NOT_CONVERSATION_PARTY');
  });

  it('stores messages in order and supports incremental reads', async () => {
    const trade = await startTrade(ctx);

    const first = await send(trade, 'owner', 'سلام، در مسیرم');
    expect(first.statusCode).toBe(201);
    const firstMessage = json<{ id: string; kind: string; senderId: string; createdAt: string }>(
      first,
    );
    expect(firstMessage.kind).toBe('TEXT');
    expect(firstMessage.senderId).toBe(trade.owner.userId);

    const second = await send(trade, 'taker', 'پمپ شلوغ است');
    expect(second.statusCode).toBe(201);

    const all = await ctx.app.inject({
      method: 'GET',
      url: `/v1/conversations/${trade.conversationId}/messages`,
      headers: auth(trade.taker.token),
    });
    expect(all.statusCode).toBe(200);
    const listed = json<{ items: { body: string }[]; nextCursor: string }>(all);
    expect(listed.items.map((m) => m.body)).toEqual(['سلام، در مسیرم', 'پمپ شلوغ است']);
    expect(listed.nextCursor).toBeTruthy();

    const incremental = await ctx.app.inject({
      method: 'GET',
      url: `/v1/conversations/${trade.conversationId}/messages?after=${encodeURIComponent(
        firstMessage.createdAt,
      )}`,
      headers: auth(trade.taker.token),
    });
    expect(incremental.statusCode).toBe(200);
    const newer = json<{ items: { body: string }[] }>(incremental);
    expect(newer.items.map((m) => m.body)).toEqual(['پمپ شلوغ است']);
  });

  it('treats a retried clientMessageId as the same message', async () => {
    const trade = await startTrade(ctx);
    const clientMessageId = crypto.randomUUID();

    const first = await send(trade, 'taker', '۵ دقیقه دیگر می‌رسم', clientMessageId);
    expect(first.statusCode).toBe(201);
    const second = await send(trade, 'taker', '۵ دقیقه دیگر می‌رسم', clientMessageId);
    expect(second.statusCode).toBe(201);
    expect(json<{ id: string }>(second).id).toBe(json<{ id: string }>(first).id);

    const listed = await ctx.app.inject({
      method: 'GET',
      url: `/v1/conversations/${trade.conversationId}/messages`,
      headers: auth(trade.owner.token),
    });
    expect(json<{ items: unknown[] }>(listed).items).toHaveLength(1);
  });

  it('enforces the runtime message length, not only the schema cap', async () => {
    const admin = await loginAsRole(ctx, freshPhone(), 'ADMIN');
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: auth(admin.token),
      payload: { 'chat.max_message_length': 40 },
    });
    try {
      const trade = await startTrade(ctx);

      const tooLong = await send(trade, 'owner', 'ا'.repeat(41));
      expect(tooLong.statusCode).toBe(422);
      expect(
        json<{ error: { code: string; details: { maxLength: number } } }>(tooLong).error,
      ).toEqual(expect.objectContaining({ code: 'MESSAGE_TOO_LONG', details: { maxLength: 40 } }));

      const exactly = await send(trade, 'owner', 'ب'.repeat(40));
      expect(exactly.statusCode).toBe(201);
    } finally {
      await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/admin/settings',
        headers: auth(admin.token),
        payload: { 'chat.max_message_length': 500 },
      });
    }
  });

  it('tracks read receipts and unread counts per party', async () => {
    const trade = await startTrade(ctx);
    await send(trade, 'taker', 'کارت را آماده کنید');
    await send(trade, 'taker', 'رسیدم');

    const ownerList = await ctx.app.inject({
      method: 'GET',
      url: '/v1/chat/conversations',
      headers: auth(trade.owner.token),
    });
    const conversations = json<{ items: { id: string; unreadCount: number }[] }>(ownerList).items;
    expect(conversations.find((c) => c.id === trade.conversationId)?.unreadCount).toBe(2);

    const read = await ctx.app.inject({
      method: 'POST',
      url: `/v1/conversations/${trade.conversationId}/read`,
      headers: auth(trade.owner.token),
    });
    expect(read.statusCode).toBe(200);
    expect(json<{ read: number; unread: number }>(read)).toEqual({ read: 2, unread: 0 });

    const takerView = await ctx.app.inject({
      method: 'GET',
      url: `/v1/conversations/${trade.conversationId}/messages`,
      headers: auth(trade.taker.token),
    });
    const messages = json<{ items: { readAt: string | null }[] }>(takerView).items;
    expect(messages.every((message) => message.readAt !== null)).toBe(true);
  });

  it('closes the thread once the trade is completed', async () => {
    const trade = await startTrade(ctx);
    const completed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/complete`,
      headers: auth(trade.taker.token),
    });
    expect(completed.statusCode).toBe(200);

    const blocked = await send(trade, 'owner', 'ممنون از معامله');
    expect(blocked.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(blocked).error.code).toBe('CONVERSATION_CLOSED');

    const thread = await ctx.app.inject({
      method: 'GET',
      url: `/v1/conversations/${trade.conversationId}`,
      headers: auth(trade.owner.token),
    });
    const view = json<{ writable: boolean; closedAt: string | null }>(thread);
    expect(view.writable).toBe(false);
    expect(view.closedAt).not.toBeNull();
  });

  it('serves quick replies from runtime settings', async () => {
    const admin = await loginAsRole(ctx, freshPhone(), 'ADMIN');
    const before = await ctx.app.inject({
      method: 'GET',
      url: '/v1/chat/quick-replies',
      headers: auth(admin.token),
    });
    expect(json<{ items: string[] }>(before).items).toContain('سلام، در مسیرم');

    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: auth(admin.token),
      payload: { 'chat.quick_replies': ['رسیدم', 'دو دقیقه دیگر'] },
    });
    try {
      const after = await ctx.app.inject({
        method: 'GET',
        url: '/v1/chat/quick-replies',
        headers: auth(admin.token),
      });
      expect(json<{ items: string[] }>(after).items).toEqual(['رسیدم', 'دو دقیقه دیگر']);
    } finally {
      await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/admin/settings',
        headers: auth(admin.token),
        payload: {
          'chat.quick_replies': [
            'سلام، در مسیرم',
            '۵ دقیقه دیگر می‌رسم',
            'پمپ شلوغ است',
            'کارت را آماده کنید',
          ],
        },
      });
    }
  });
});
