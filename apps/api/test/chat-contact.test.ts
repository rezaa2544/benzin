import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  startTrade,
  type TestContext,
  type TradeSetup,
} from './helpers.js';

const json = <T>(response: { json: () => unknown }): T => response.json() as T;

const post = (ctx: TestContext, trade: TradeSetup, token: string, body: string) =>
  ctx.app.inject({
    method: 'POST',
    url: `/v1/conversations/${trade.conversationId}/messages`,
    headers: auth(token),
    payload: { body },
  });

describe('chat contact sharing', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('masks phone numbers while the owner has not accepted yet', async () => {
    const trade = await startTrade(ctx, { confirm: false });

    const response = await post(ctx, trade, trade.taker.token, 'شماره من 09121234567 است');
    expect(response.statusCode).toBe(201);
    const message = json<{ body: string; contactMasked: boolean }>(response);
    expect(message.contactMasked).toBe(true);
    expect(message.body).not.toContain('09121234567');
    expect(message.body).toContain('۰۹۱۲');
    expect(message.body).toContain('۶۷');
    expect(message.body).toMatch(/•+/);

    // The raw number is nowhere in the stored thread, so the owner cannot read it.
    const listed = await ctx.app.inject({
      method: 'GET',
      url: `/v1/conversations/${trade.conversationId}/messages`,
      headers: auth(trade.owner.token),
    });
    expect(listed.body).not.toContain('09121234567');
    expect(listed.body).not.toContain('۰۹۱۲۱۲۳۴۵۶۷');

    const audit = await ctx.repos.audit.list(20);
    const entry = audit.find((row) => row.action === 'chat.message_sent');
    expect(entry?.metadata.contactMasked).toBe(1);
  });

  it('masks country codes, separators and Persian digits too', async () => {
    const trade = await startTrade(ctx, { confirm: false });

    for (const raw of ['+98 912 123 4567', '0098-912-123-4567', '۰۹۱۲۱۲۳۴۵۶۷', '912 123 4567']) {
      const response = await post(ctx, trade, trade.taker.token, `تماس: ${raw}`);
      expect(response.statusCode).toBe(201);
      const message = json<{ body: string; contactMasked: boolean }>(response);
      expect(message.contactMasked).toBe(true);
      expect(message.body).not.toMatch(/[\d۰-۹]{7,}/);
    }
  });

  it('keeps every digit once the trade is confirmed', async () => {
    const trade = await startTrade(ctx);

    const response = await post(ctx, trade, trade.taker.token, 'شماره من 09121234567 است');
    expect(response.statusCode).toBe(201);
    const message = json<{ body: string; contactMasked: boolean }>(response);
    expect(message.contactMasked).toBe(false);
    expect(message.body).toBe('شماره من 09121234567 است');
  });

  it('refuses a contact card before the owner accepts', async () => {
    const trade = await startTrade(ctx, { confirm: false });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/conversations/${trade.conversationId}/contact`,
      headers: auth(trade.taker.token),
    });
    expect(response.statusCode).toBe(409);
    const error = json<{ error: { code: string; details: { orderStatus: string } } }>(
      response,
    ).error;
    expect(error.code).toBe('CONTACT_SHARING_BLOCKED');
    expect(error.details.orderStatus).toBe('RESERVED');
  });

  it('sends a contact card with the sender phone number after confirmation', async () => {
    const trade = await startTrade(ctx);

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/conversations/${trade.conversationId}/contact`,
      headers: auth(trade.taker.token),
    });
    expect(response.statusCode).toBe(201);
    const card = json<{ kind: string; body: string; senderId: string }>(response);
    expect(card.kind).toBe('CONTACT');
    expect(card.body).toBe(trade.taker.phone);
    expect(card.senderId).toBe(trade.taker.userId);

    // The peer is told a number arrived, without the number itself in the notification.
    const inbox = await ctx.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: auth(trade.owner.token),
    });
    const items = json<{ items: { kind: string; bodyFa: string }[] }>(inbox).items;
    const shared = items.find((item) => item.kind === 'CONTACT_SHARED');
    expect(shared).toBeTruthy();
    expect(shared?.bodyFa).toContain('شماره تماس');
    expect(shared?.bodyFa).not.toContain(trade.taker.phone);
  });

  it('blocks a stranger from sharing a contact card', async () => {
    const trade = await startTrade(ctx);

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/conversations/${trade.conversationId}/contact`,
      headers: auth('not-a-real-token'),
    });
    expect(response.statusCode).toBe(401);

    const third = await startTrade(ctx);
    const crossThread = await ctx.app.inject({
      method: 'POST',
      url: `/v1/conversations/${trade.conversationId}/contact`,
      headers: auth(third.taker.token),
    });
    expect(crossThread.statusCode).toBe(403);
    expect(json<{ error: { code: string } }>(crossThread).error.code).toBe(
      'NOT_CONVERSATION_PARTY',
    );
  });
});
