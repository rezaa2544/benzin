import { describe, expect, it } from 'vitest';
import { createTestContext, freshPhone, login, orderPayload, auth } from './helpers.js';

/**
 * Task E1-07 — light load test for the product's abuse caps.
 *
 * Every cap is checked sequentially elsewhere; this file fires bursts of parallel requests at the
 * same resource and asserts the limit still holds. It runs against the real Fastify app with the
 * in-memory repositories, so it is deterministic and cheap enough for CI.
 *
 * Concurrency used here is deliberately small (a "light" load test): enough to interleave every
 * await inside a critical section, not enough to make the suite slow or flaky.
 */

const BURST = 25;

interface Injected {
  statusCode: number;
  body: string;
  json: () => unknown;
}

const errorCode = (response: Injected): string => {
  try {
    return (JSON.parse(response.body) as { error?: { code?: string } }).error?.code ?? '';
  } catch {
    return '';
  }
};

const burst = async (
  count: number,
  send: (index: number) => Promise<Injected>,
): Promise<Injected[]> => Promise.all(Array.from({ length: count }, (_, index) => send(index)));

const countBy = (responses: Injected[], statusCode: number): number =>
  responses.filter((response) => response.statusCode === statusCode).length;

const countCode = (responses: Injected[], code: string): number =>
  responses.filter((response) => errorCode(response) === code).length;

describe('abuse caps under a parallel burst (E1-07)', () => {
  it('sends exactly one OTP for a burst of requests on the same phone', async () => {
    const ctx = await createTestContext();
    try {
      const phone = freshPhone();
      const responses = await burst(BURST, () =>
        ctx.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } }),
      );

      expect(countBy(responses, 202)).toBe(1);
      expect(countBy(responses, 429)).toBe(BURST - 1);
      // The cooldown protects the SMS bill, not just the API: one message leaves the building.
      expect(ctx.sms.messages.filter((message) => message.phone === phone)).toHaveLength(1);
      expect(countCode(responses, 'RATE_LIMITED')).toBe(BURST - 1);
    } finally {
      await ctx.close();
    }
  });

  it('cannot spend more than otp.max_attempts guesses in parallel', async () => {
    const ctx = await createTestContext();
    try {
      const phone = freshPhone();
      await ctx.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
      const real = ctx.sms.lastCodeFor(phone);
      const wrong = real === '00000' ? '11111' : '00000';

      const responses = await burst(40, () =>
        ctx.app.inject({
          method: 'POST',
          url: '/v1/auth/otp/verify',
          payload: { phone, code: wrong },
        }),
      );

      // Five guesses consumed, the rest refused: a parallel spray buys the attacker nothing.
      expect(countCode(responses, 'OTP_INVALID')).toBe(5);
      expect(countCode(responses, 'OTP_ATTEMPTS_EXCEEDED')).toBe(35);
      const late = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/otp/verify',
        payload: { phone, code: real },
      });
      expect(late.statusCode).toBe(429);
    } finally {
      await ctx.close();
    }
  });

  it('creates at most order.max_open_per_user orders from a burst', async () => {
    const ctx = await createTestContext();
    try {
      const phone = freshPhone();
      const owner = await login(ctx, phone);
      const responses = await burst(BURST, () =>
        ctx.app.inject({
          method: 'POST',
          url: '/v1/orders',
          headers: auth(owner.token),
          payload: orderPayload(),
        }),
      );

      expect(countBy(responses, 201)).toBe(2);
      expect(countCode(responses, 'ORDER_LIMIT_REACHED')).toBe(BURST - 2);
      expect(await ctx.repos.orders.countOpenByOwner(owner.userId, new Date())).toBe(2);
    } finally {
      await ctx.close();
    }
  });

  it('gives one order to exactly one of twenty competing takers', async () => {
    const ctx = await createTestContext();
    try {
      const owner = await login(ctx, freshPhone());
      const order = await ctx.app.inject({
        method: 'POST',
        url: '/v1/orders',
        headers: auth(owner.token),
        payload: orderPayload(),
      });
      const orderId = (order.json() as { id: string }).id;
      const takers = await Promise.all(Array.from({ length: 20 }, () => login(ctx, freshPhone())));

      const responses = await burst(20, (index) =>
        ctx.app.inject({
          method: 'POST',
          url: `/v1/orders/${orderId}/reservations`,
          headers: auth(takers[index]!.token),
        }),
      );

      expect(countBy(responses, 201)).toBe(1);
      expect(countBy(responses, 409)).toBe(19);
      expect(countBy(responses, 500)).toBe(0);
      // The winner's reservation is the only live one for that order.
      expect(await ctx.repos.reservations.findActiveByOrder(orderId)).not.toBeNull();
    } finally {
      await ctx.close();
    }
  });

  it('keeps one active reservation when a taker sprays twenty orders', async () => {
    const ctx = await createTestContext();
    try {
      const taker = await login(ctx, freshPhone());
      const orderIds: string[] = [];
      for (let index = 0; index < 10; index += 1) {
        const owner = await login(ctx, freshPhone());
        for (let slot = 0; slot < 2; slot += 1) {
          const created = await ctx.app.inject({
            method: 'POST',
            url: '/v1/orders',
            headers: auth(owner.token),
            payload: orderPayload(),
          });
          expect(created.statusCode).toBe(201);
          orderIds.push((created.json() as { id: string }).id);
        }
      }
      expect(orderIds).toHaveLength(20);

      const responses = await burst(20, (index) =>
        ctx.app.inject({
          method: 'POST',
          url: `/v1/orders/${orderIds[index]!}/reservations`,
          headers: auth(taker.token),
        }),
      );

      expect(countBy(responses, 201)).toBe(1);
      expect(countCode(responses, 'RESERVATION_LIMIT_REACHED')).toBe(19);
      expect(await ctx.repos.reservations.findActiveByTaker(taker.userId)).toHaveLength(1);
    } finally {
      await ctx.close();
    }
  });

  it('rotates a refresh token exactly once when the same token is replayed in parallel', async () => {
    const ctx = await createTestContext();
    try {
      const phone = freshPhone();
      const issued = await login(ctx, phone);

      const responses = await burst(12, () =>
        ctx.app.inject({
          method: 'POST',
          url: '/v1/auth/refresh',
          payload: { refreshToken: issued.refreshToken },
        }),
      );

      // One winner; every loser is a replay, so the family is revoked and no forked chain survives.
      expect(countBy(responses, 200)).toBe(1);
      expect(countBy(responses, 401)).toBe(11);

      const winner = responses.find((response) => response.statusCode === 200)!;
      const rotated = winner.json() as { refreshToken: string };
      const after = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refreshToken: rotated.refreshToken },
      });
      expect(after.statusCode).toBe(401);

      const audit = await ctx.repos.audit.list(200);
      expect(audit.some((entry) => entry.action === 'auth.refresh_reuse_detected')).toBe(true);
    } finally {
      await ctx.close();
    }
  });
});
