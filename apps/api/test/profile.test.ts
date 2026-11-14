import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  freshPhone,
  login,
  startTrade,
  type TestContext,
} from './helpers.js';

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

const patchMe = (token: string, payload: unknown) =>
  ctx.app.inject({ method: 'PATCH', url: '/v1/me', headers: auth(token), payload });

describe('user profile (E1-05)', () => {
  it('returns the caller from /v1/me with no display name by default', async () => {
    const phone = freshPhone();
    const { token, userId } = await login(ctx, phone);

    const response = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth(token) });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: userId, phone, displayName: null });
    expect(response.json().createdAt).toEqual(expect.any(String));
  });

  it('saves a trimmed display name and reflects it on /v1/me', async () => {
    const { token } = await login(ctx, freshPhone());

    const patched = await patchMe(token, { displayName: '  رضا بنزین  ' });

    expect(patched.statusCode).toBe(200);
    expect(patched.json().displayName).toBe('رضا بنزین');

    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth(token) });
    expect(me.json().displayName).toBe('رضا بنزین');
  });

  it('clears the name when null is sent', async () => {
    const { token } = await login(ctx, freshPhone());
    await patchMe(token, { displayName: 'اسم موقت' });

    const cleared = await patchMe(token, { displayName: null });

    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().displayName).toBeNull();
  });

  it('rejects names that are too short, too long or phone-like', async () => {
    const { token } = await login(ctx, freshPhone());

    const tooShort = await patchMe(token, { displayName: 'ر' });
    expect(tooShort.statusCode).toBe(422);
    expect(tooShort.json().error.code).toBe('VALIDATION_ERROR');

    const tooLong = await patchMe(token, { displayName: 'x'.repeat(61) });
    expect(tooLong.statusCode).toBe(422);

    const phoneLike = await patchMe(token, { displayName: '0912 345 6789' });
    expect(phoneLike.statusCode).toBe(422);
    expect(JSON.stringify(phoneLike.json().error.details)).toContain('DISPLAY_NAME_INVALID');
  });

  it('refuses unknown fields instead of silently ignoring them', async () => {
    const { token } = await login(ctx, freshPhone());

    const response = await patchMe(token, { displayName: 'نام درست', role: 'ADMIN' });

    expect(response.statusCode).toBe(422);
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: auth(token) });
    expect(me.json().role).toBe('USER');
  });

  it('requires a session for both the edit and the public card', async () => {
    const edit = await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/me',
      payload: { displayName: 'بدون نشست' },
    });
    expect(edit.statusCode).toBe(401);

    const card = await ctx.app.inject({ method: 'GET', url: '/v1/users/someone' });
    expect(card.statusCode).toBe(401);
  });

  it('writes an audit entry with the before and after value', async () => {
    const { token, userId } = await login(ctx, freshPhone());
    await patchMe(token, { displayName: 'نام اول' });
    await patchMe(token, { displayName: 'نام دوم' });

    const entries = await ctx.repos.audit.list(50);
    const updates = entries.filter((entry) => entry.action === 'user.profile_updated');

    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      actorId: userId,
      entity: 'user',
      entityId: userId,
      metadata: { before: 'نام اول', after: 'نام دوم' },
    });
  });

  it('shows the chosen name to the counterpart in the conversation', async () => {
    const trade = await startTrade(ctx, { confirm: true });
    const owner = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: auth(trade.owner.token),
    });
    expect(owner.json().displayName).toBeNull();

    await patchMe(trade.owner.token, { displayName: 'صاحب سفارش' });

    const conversation = await ctx.app.inject({
      method: 'GET',
      url: `/v1/conversations/${trade.conversationId}`,
      headers: auth(trade.taker.token),
    });
    expect(conversation.json().peer.displayName).toBe('صاحب سفارش');
  });

  it('serves a public card with trust data and never the phone', async () => {
    const trade = await startTrade(ctx, { confirm: true });
    await patchMe(trade.owner.token, { displayName: 'فروشنده بانه' });

    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/users/${trade.owner.userId}`,
      headers: auth(trade.taker.token),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      id: trade.owner.userId,
      displayName: 'فروشنده بانه',
      levelFa: expect.any(String),
      completedTrades: 0,
      ratingCount: 0,
      averageStars: null,
    });
    expect(body['score']).toEqual(expect.any(Number));
    expect(body['memberSince']).toEqual(expect.any(String));
    expect(JSON.stringify(body)).not.toContain(trade.owner.phone);
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('role');
  });

  it('404s for a user that does not exist', async () => {
    const { token } = await login(ctx, freshPhone());

    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/users/00000000-0000-4000-8000-000000000000',
      headers: auth(token),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('USER_NOT_FOUND');
  });

  it('counts completed trades and ratings on the public card', async () => {
    const trade = await startTrade(ctx, { confirm: true });
    const completed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/complete`,
      headers: auth(trade.owner.token),
    });
    expect(completed.statusCode).toBe(200);

    const rated = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/rating`,
      headers: auth(trade.taker.token),
      payload: { stars: 5 },
    });
    expect(rated.statusCode).toBe(201);

    const ownerCard = await ctx.app.inject({
      method: 'GET',
      url: `/v1/users/${trade.owner.userId}`,
      headers: auth(trade.taker.token),
    });
    expect(ownerCard.json()).toMatchObject({
      completedTrades: 1,
      ratingCount: 1,
      averageStars: 5,
    });
    expect(ownerCard.json().level).toMatch(/^(GOLD|SILVER|BRONZE)$/);
  });
});
