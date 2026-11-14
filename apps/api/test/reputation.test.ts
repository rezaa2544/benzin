import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  freshPhone,
  login,
  loginAsRole,
  ManualClock,
  startTrade,
  type TestContext,
} from './helpers.js';

const json = <T>(response: { json: () => unknown }): T => response.json() as T;

interface Summary {
  userId: string;
  score: number;
  level: string;
  levelFa: string;
  completedTrades: number;
  cancelledTrades: number;
  disputes: number;
  ratingCount: number;
  averageStars: number | null;
  suspendedUntil: string | null;
  recentEvents: { kind: string; labelFa: string; delta: number }[];
}

const summaryOf = async (ctx: TestContext, token: string): Promise<Summary> => {
  const response = await ctx.app.inject({
    method: 'GET',
    url: '/v1/me/reputation',
    headers: auth(token),
  });
  expect(response.statusCode).toBe(200);
  return json<Summary>(response);
};

describe('reputation', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('rewrites the score of both parties after a completed trade', async () => {
    const trade = await startTrade(ctx);
    const completed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/complete`,
      headers: auth(trade.owner.token),
    });
    expect(completed.statusCode).toBe(200);

    const owner = await summaryOf(ctx, trade.owner.token);
    expect(owner.score).toBe(55);
    expect(owner.level).toBe('SILVER');
    expect(owner.levelFa).toBe('نقره‌ای');
    expect(owner.completedTrades).toBe(1);
    expect(owner.recentEvents[0]).toEqual(
      expect.objectContaining({ kind: 'TRADE_COMPLETED', labelFa: 'معامله‌ی موفق', delta: 5 }),
    );

    const taker = await summaryOf(ctx, trade.taker.token);
    expect(taker.score).toBe(55);
  });

  it('penalises the party who walks away from a reservation', async () => {
    const trade = await startTrade(ctx);
    const cancelled = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/cancel`,
      headers: auth(trade.taker.token),
      payload: { reason: 'CHANGED_MIND' },
    });
    expect(cancelled.statusCode).toBe(200);

    const taker = await summaryOf(ctx, trade.taker.token);
    expect(taker.score).toBe(47);
    expect(taker.level).toBe('BRONZE');
    expect(taker.cancelledTrades).toBe(1);

    // The owner did nothing wrong and keeps the neutral score.
    const owner = await summaryOf(ctx, trade.owner.token);
    expect(owner.score).toBe(50);
  });

  it('exposes a public card with score and level only', async () => {
    const trade = await startTrade(ctx);
    const response = await ctx.app.inject({
      method: 'GET',
      url: `/v1/users/${trade.owner.userId}/reputation`,
      headers: auth(trade.taker.token),
    });
    expect(response.statusCode).toBe(200);
    const card = json<Record<string, unknown>>(response);
    expect(card).toEqual({
      userId: trade.owner.userId,
      score: 50,
      level: 'SILVER',
      levelFa: 'نقره‌ای',
    });
    expect(card.recentEvents).toBeUndefined();
  });

  it('accepts one quick rating per party and folds it into the score', async () => {
    const trade = await startTrade(ctx);
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/complete`,
      headers: auth(trade.taker.token),
    });

    const rated = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/rating`,
      headers: auth(trade.taker.token),
      payload: { stars: 5, comment: 'هماهنگ و خوش‌قول' },
    });
    expect(rated.statusCode).toBe(201);
    const rating = json<{ stars: number; subjectId: string; comment: string }>(rated);
    expect(rating.subjectId).toBe(trade.owner.userId);
    expect(rating.stars).toBe(5);
    expect(rating.comment).toBe('هماهنگ و خوش‌قول');

    const owner = await summaryOf(ctx, trade.owner.token);
    expect(owner.score).toBe(57); // +5 trade, +2 rating
    expect(owner.ratingCount).toBe(1);
    expect(owner.averageStars).toBe(5);

    const duplicate = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/rating`,
      headers: auth(trade.taker.token),
      payload: { stars: 1 },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(duplicate).error.code).toBe('ALREADY_RATED');

    const inbox = await ctx.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: auth(trade.owner.token),
    });
    const items = json<{ items: { kind: string; bodyFa: string }[] }>(inbox).items;
    const received = items.find((item) => item.kind === 'RATING_RECEIVED');
    expect(received?.bodyFa).toContain('۵ از ۵ ستاره');
  });

  it('refuses ratings before the hand-over, from strangers, or outside 1…5', async () => {
    const trade = await startTrade(ctx);

    const tooEarly = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/rating`,
      headers: auth(trade.taker.token),
      payload: { stars: 4 },
    });
    expect(tooEarly.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(tooEarly).error.code).toBe('INVALID_STATE_TRANSITION');

    await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/complete`,
      headers: auth(trade.owner.token),
    });

    const outsider = (await login(ctx, freshPhone())).token;
    const stranger = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/rating`,
      headers: auth(outsider),
      payload: { stars: 4 },
    });
    expect(stranger.statusCode).toBe(403);

    const invalid = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${trade.reservationId}/rating`,
      headers: auth(trade.taker.token),
      payload: { stars: 6 },
    });
    expect(invalid.statusCode).toBe(422);
    expect(json<{ error: { code: string } }>(invalid).error.code).toBe('VALIDATION_ERROR');
  });

  it('suspends an account below the trust threshold and blocks it everywhere', async () => {
    const user = await loginAsRole(ctx, freshPhone(), 'ADMIN');
    for (let i = 0; i < 4; i += 1) {
      await ctx.services.reputation.record({ userId: user.userId, kind: 'REPORT_CONFIRMED' });
    }

    const profile = await ctx.repos.users.findById(user.userId);
    expect(profile?.status).toBe('SUSPENDED');
    expect(profile?.suspendedUntil).not.toBeNull();

    const blocked = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: auth(user.token),
    });
    expect(blocked.statusCode).toBe(403);
    expect(json<{ error: { code: string } }>(blocked).error.code).toBe('ACCOUNT_SUSPENDED');

    const notifications = await ctx.repos.notifications.listByUser(user.userId, {
      limit: 10,
      unreadOnly: false,
    });
    expect(notifications.some((item) => item.kind === 'ACCOUNT_SUSPENDED')).toBe(true);
  });
});

describe('reputation suspension expiry', () => {
  let ctx: TestContext;
  const clock = new ManualClock();

  beforeAll(async () => {
    ctx = await createTestContext(clock);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('restores the account once the suspension window elapses', async () => {
    const phone = freshPhone();
    const { userId } = await login(ctx, phone);
    for (let i = 0; i < 4; i += 1) {
      await ctx.services.reputation.record({ userId, kind: 'REPORT_CONFIRMED' });
    }
    expect((await ctx.repos.users.findById(userId))?.status).toBe('SUSPENDED');

    clock.advanceHours(25);
    expect(await ctx.services.reputation.liftDueSuspensions()).toBe(1);

    const restored = await ctx.repos.users.findById(userId);
    expect(restored?.status).toBe('ACTIVE');
    expect(restored?.suspendedUntil).toBeNull();

    // The user can log in and trade again.
    const fresh = await login(ctx, phone);
    const orders = await ctx.app.inject({
      method: 'GET',
      url: '/v1/orders/mine',
      headers: auth(fresh.token),
    });
    expect(orders.statusCode).toBe(200);

    const notifications = await ctx.repos.notifications.listByUser(userId, {
      limit: 10,
      unreadOnly: false,
    });
    expect(notifications.some((item) => item.kind === 'ACCOUNT_RESTORED')).toBe(true);
  });
});
