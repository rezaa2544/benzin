import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  freshPhone,
  login,
  loginAsRole,
  ManualClock,
  orderPayload,
  type TestContext,
} from './helpers.js';
import { ZarinpalGatewayProvider } from '../src/modules/payment-providers.js';

const json = <T>(response: { json: () => unknown }): T => response.json() as T;

interface StartView {
  id: string;
  provider: string;
  status: string;
  amountToman: number;
  uniqueAmountToman: number | null;
  amountLabelFa: string;
  redirectUrl: string | null;
  destination: { cardNumber: string; holderName: string } | null;
  instructionFa: string;
  expiresAt: string;
}

const startPurchase = async (
  ctx: TestContext,
  token: string,
  body: Record<string, unknown>,
): Promise<StartView> => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/subscriptions',
    headers: auth(token),
    payload: body,
  });
  expect(response.statusCode).toBe(201);
  return json<StartView>(response);
};

describe('plans and subscriptions', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestContext();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('lists the seeded plans with Persian price labels', async () => {
    const user = await login(ctx, freshPhone());
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/plans',
      headers: auth(user.token),
    });
    expect(response.statusCode).toBe(200);
    const items = json<{ items: { code: string; priceLabelFa: string; durationDays: number }[] }>(
      response,
    ).items;
    expect(items.map((plan) => plan.code)).toEqual(['monthly', 'quarterly']);
    expect(items[0]?.priceLabelFa).toBe('۴۹٬۰۰۰ تومان');
    expect(items[0]?.durationDays).toBe(30);
  });

  it('starts a card-to-card purchase with a unique amount and the destination card', async () => {
    const user = await login(ctx, freshPhone());
    const started = await startPurchase(ctx, user.token, {
      planCode: 'monthly',
      method: 'CARD_TO_CARD',
    });

    expect(started.provider).toBe('CARD_TO_CARD');
    expect(started.status).toBe('PENDING');
    expect(started.amountToman).toBe(49_000);
    expect(started.uniqueAmountToman).toBeGreaterThan(49_000);
    expect(started.uniqueAmountToman).toBeLessThanOrEqual(49_000 + 999);
    expect(started.destination?.cardNumber).toBe('6037991234567890');
    expect(started.destination?.holderName).toBe('شرکت بنزین');
    expect(started.redirectUrl).toBeNull();
    expect(started.instructionFa).toContain('واریز کنید');

    const second = await startPurchase(ctx, user.token, {
      planCode: 'monthly',
      method: 'CARD_TO_CARD',
    });
    expect(second.uniqueAmountToman).not.toBe(
      // Two live intents can never share an amount: the operator matches transfers by it.
      started.uniqueAmountToman,
    );

    const mine = await ctx.app.inject({
      method: 'GET',
      url: '/v1/payments/mine',
      headers: auth(user.token),
    });
    expect(json<{ items: unknown[] }>(mine).items).toHaveLength(2);

    const subscription = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/subscription',
      headers: auth(user.token),
    });
    // Nothing is active before the money is confirmed.
    expect(json<{ subscription: unknown }>(subscription).subscription).toBeNull();
  });

  it('activates the subscription when the gateway confirms the payment', async () => {
    const user = await login(ctx, freshPhone());
    const started = await startPurchase(ctx, user.token, {
      planCode: 'monthly',
      method: 'GATEWAY',
    });
    expect(started.redirectUrl).toContain(started.id);
    expect(started.uniqueAmountToman).toBeNull();

    const callback = await ctx.app.inject({
      method: 'POST',
      url: `/v1/payments/${started.id}/gateway/callback`,
      headers: auth(user.token),
      payload: { reference: 'REF-12345' },
    });
    expect(callback.statusCode).toBe(200);
    const result = json<{
      payment: { status: string; reference: string; paidAt: string };
      subscription: { status: string; daysRemaining: number; planNameFa: string };
    }>(callback);
    expect(result.payment.status).toBe('PAID');
    expect(result.payment.reference).toBe('REF-12345');
    expect(result.payment.paidAt).not.toBeNull();
    expect(result.subscription.status).toBe('ACTIVE');
    expect(result.subscription.planNameFa).toBe('اشتراک یک‌ماهه');
    expect(result.subscription.daysRemaining).toBe(30);

    const current = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/subscription',
      headers: auth(user.token),
    });
    expect(json<{ subscription: { status: string } }>(current).subscription.status).toBe('ACTIVE');

    const inbox = await ctx.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: auth(user.token),
    });
    const approved = json<{ items: { kind: string; bodyFa: string }[] }>(inbox).items.find(
      (item) => item.kind === 'PAYMENT_APPROVED',
    );
    expect(approved?.bodyFa).toContain('۴۹٬۰۰۰ تومان');
    expect(approved?.bodyFa).toContain('اشتراک یک‌ماهه');

    // A second callback must not activate anything twice.
    const again = await ctx.app.inject({
      method: 'POST',
      url: `/v1/payments/${started.id}/gateway/callback`,
      headers: auth(user.token),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(again).error.code).toBe('PAYMENT_ALREADY_SETTLED');
  });

  it('marks a gateway failure as FAILED and notifies the buyer', async () => {
    const user = await login(ctx, freshPhone());
    const started = await startPurchase(ctx, user.token, {
      planCode: 'quarterly',
      method: 'GATEWAY',
    });

    const failed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/payments/${started.id}/gateway/callback`,
      headers: auth(user.token),
      payload: { reference: 'FAIL' },
    });
    expect(failed.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(failed).error.code).toBe(
      'PAYMENT_VERIFICATION_FAILED',
    );

    const payment = await ctx.app.inject({
      method: 'GET',
      url: `/v1/payments/${started.id}`,
      headers: auth(user.token),
    });
    expect(json<{ status: string }>(payment).status).toBe('FAILED');
  });

  it('refuses to pay someone else’s payment', async () => {
    const owner = await login(ctx, freshPhone());
    const other = await login(ctx, freshPhone());
    const started = await startPurchase(ctx, owner.token, {
      planCode: 'monthly',
      method: 'GATEWAY',
    });

    const response = await ctx.app.inject({
      method: 'POST',
      url: `/v1/payments/${started.id}/gateway/callback`,
      headers: auth(other.token),
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(json<{ error: { code: string } }>(response).error.code).toBe('PAYMENT_NOT_FOUND');
  });

  it('widens the open-order allowance for subscribers', async () => {
    const user = await login(ctx, freshPhone());
    const started = await startPurchase(ctx, user.token, {
      planCode: 'monthly',
      method: 'GATEWAY',
    });
    await ctx.app.inject({
      method: 'POST',
      url: `/v1/payments/${started.id}/gateway/callback`,
      headers: auth(user.token),
      payload: {},
    });

    // The free cap is 2 open orders; the monthly plan allows 3.
    for (let i = 0; i < 3; i += 1) {
      const created = await ctx.app.inject({
        method: 'POST',
        url: '/v1/orders',
        headers: auth(user.token),
        payload: orderPayload({ note: `سفارش ${i}` }),
      });
      expect(created.statusCode).toBe(201);
    }
    const fourth = await ctx.app.inject({
      method: 'POST',
      url: '/v1/orders',
      headers: auth(user.token),
      payload: orderPayload({ note: 'سفارش چهارم' }),
    });
    expect(fourth.statusCode).toBe(429);
    expect(json<{ error: { details: { limit: number } } }>(fourth).error.details.limit).toBe(3);
  });

  it('can require a subscription before trading', async () => {
    const admin = await loginAsRole(ctx, freshPhone(), 'ADMIN');
    await ctx.app.inject({
      method: 'PATCH',
      url: '/v1/admin/settings',
      headers: auth(admin.token),
      payload: { 'subscription.required_for_orders': true },
    });
    try {
      const user = await login(ctx, freshPhone());
      const blocked = await ctx.app.inject({
        method: 'POST',
        url: '/v1/orders',
        headers: auth(user.token),
        payload: orderPayload(),
      });
      expect(blocked.statusCode).toBe(403);
      expect(json<{ error: { code: string } }>(blocked).error.code).toBe('SUBSCRIPTION_REQUIRED');
    } finally {
      await ctx.app.inject({
        method: 'PATCH',
        url: '/v1/admin/settings',
        headers: auth(admin.token),
        payload: { 'subscription.required_for_orders': false },
      });
    }
  });
});

describe('billing reconciliation', () => {
  let ctx: TestContext;
  const clock = new ManualClock();

  beforeAll(async () => {
    ctx = await createTestContext(clock);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('expires stale intents and closes finished subscriptions', async () => {
    const phone = freshPhone();
    const user = await login(ctx, phone);
    const started = await startPurchase(ctx, user.token, {
      planCode: 'monthly',
      method: 'CARD_TO_CARD',
    });

    clock.advanceHours(3);
    const first = await ctx.services.payments.reconcile();
    expect(first.expiredPayments).toBeGreaterThanOrEqual(1);

    const payment = await ctx.services.payments.getPayment(
      { ...(await ctx.repos.users.findById(user.userId))!, role: 'USER' },
      started.id,
    );
    expect(payment.status).toBe('EXPIRED');

    // Nothing is left to reconcile on the second pass.
    const second = await ctx.services.payments.reconcile();
    expect(second.expiredPayments).toBe(0);

    // A paid subscription expires after its window and the owner is told.
    // (The jumped clock invalidated the access token, so log in again first.)
    const refreshed = (await login(ctx, phone)).token;
    const gateway = await startPurchase(ctx, refreshed, {
      planCode: 'monthly',
      method: 'GATEWAY',
    });
    const paid = await ctx.app.inject({
      method: 'POST',
      url: `/v1/payments/${gateway.id}/gateway/callback`,
      headers: auth(refreshed),
      payload: {},
    });
    expect(paid.statusCode).toBe(200);

    clock.advanceHours(24 * 31);
    const third = await ctx.services.payments.reconcile();
    expect(third.expiredSubscriptions).toBeGreaterThanOrEqual(1);

    const notifications = await ctx.repos.notifications.listByUser(user.userId, {
      limit: 20,
      unreadOnly: false,
    });
    expect(notifications.some((item) => item.kind === 'SUBSCRIPTION_EXPIRED')).toBe(true);
  });

  it('heals a paid payment whose subscription never activated', async () => {
    const user = await login(ctx, freshPhone());
    const started = await startPurchase(ctx, user.token, {
      planCode: 'monthly',
      method: 'GATEWAY',
    });

    // Simulate a crash between "payment marked paid" and "subscription activated".
    const payment = await ctx.repos.payments.findById(started.id);
    if (!payment) throw new Error('payment missing');
    await ctx.repos.payments.transition(payment.id, 'PENDING', 'PAID', {
      paidAt: clock.now(),
      reference: 'CRASHED-CALLBACK',
    });

    const report = await ctx.services.payments.reconcile();
    expect(report.healedPayments).toBeGreaterThanOrEqual(1);

    const subscription = await ctx.repos.subscriptions.findById(payment.subscriptionId ?? '');
    expect(subscription?.status).toBe('ACTIVE');
  });
});

describe('zarinpal provider', () => {
  it('maps Toman to Rial on request and verify', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const provider = new ZarinpalGatewayProvider({
      merchantId: 'merchant-123',
      callbackUrl: 'https://app.benzin.ir/payments/callback',
      fetchImpl: async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) as Record<string, unknown> });
        if (url.endsWith('/request.json')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: { code: 100, authority: 'A000000000000000000000000000001' },
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { code: 100, ref_id: 12345 } }),
        };
      },
    });

    const init = await provider.init({ paymentId: 'p1', amountToman: 49_000 });
    expect(init.authority).toBe('A000000000000000000000000000001');
    expect(init.redirectUrl).toContain('A000000000000000000000000000001');
    expect(calls[0]?.body).toEqual(
      expect.objectContaining({ merchant_id: 'merchant-123', amount: 490_000 }),
    );

    const verified = await provider.verify({
      paymentId: 'p1',
      amountToman: 49_000,
      authority: 'A000000000000000000000000000001',
      reference: null,
    });
    expect(verified).toEqual({ ok: true, reference: '12345', reason: null });
    expect(calls[1]?.body).toEqual(expect.objectContaining({ amount: 490_000 }));
  });

  it('reports a rejected verification instead of throwing', async () => {
    const provider = new ZarinpalGatewayProvider({
      merchantId: 'merchant-123',
      callbackUrl: 'https://app.benzin.ir/payments/callback',
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: { code: -51 } }),
      }),
    });
    const result = await provider.verify({
      paymentId: 'p1',
      amountToman: 49_000,
      authority: 'A1',
      reference: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('GATEWAY_CODE_-51');
  });
});
