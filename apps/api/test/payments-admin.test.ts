import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auth,
  createTestContext,
  freshPhone,
  login,
  loginAsRole,
  type TestContext,
} from './helpers.js';

const json = <T>(response: { json: () => unknown }): T => response.json() as T;

interface PaymentRow {
  id: string;
  status: string;
  amountToman: number;
  uniqueAmountToman: number | null;
}

const purchase = async (ctx: TestContext, token: string): Promise<PaymentRow> => {
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/subscriptions',
    headers: auth(token),
    payload: { planCode: 'monthly', method: 'CARD_TO_CARD' },
  });
  expect(response.statusCode).toBe(201);
  return json<PaymentRow>(response);
};

describe('admin payment operations', () => {
  let ctx: TestContext;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await createTestContext();
    adminToken = (await loginAsRole(ctx, freshPhone(), 'ADMIN')).token;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('confirms a card-to-card transfer and activates the subscription', async () => {
    const buyer = await login(ctx, freshPhone());
    const payment = await purchase(ctx, buyer.token);

    const pending = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/payments?status=PENDING',
      headers: auth(adminToken),
    });
    expect(pending.statusCode).toBe(200);
    const rows = json<{ items: PaymentRow[] }>(pending).items;
    expect(rows.some((row) => row.id === payment.id)).toBe(true);

    const confirmed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/payments/${payment.id}/confirm`,
      headers: auth(adminToken),
      payload: { reference: 'TRACK-998877' },
    });
    expect(confirmed.statusCode).toBe(200);
    const result = json<{
      payment: { status: string; reference: string };
      subscription: { status: string; planCode: string };
    }>(confirmed);
    expect(result.payment.status).toBe('PAID');
    expect(result.payment.reference).toBe('TRACK-998877');
    expect(result.subscription.status).toBe('ACTIVE');
    expect(result.subscription.planCode).toBe('monthly');

    const inbox = await ctx.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: auth(buyer.token),
    });
    expect(
      json<{ items: { kind: string }[] }>(inbox).items.some(
        (item) => item.kind === 'PAYMENT_APPROVED',
      ),
    ).toBe(true);

    const audit = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/audit?limit=20',
      headers: auth(adminToken),
    });
    expect(
      json<{ items: { action: string }[] }>(audit).items.some(
        (row) => row.action === 'payment.paid',
      ),
    ).toBe(true);
  });

  it('rejects a transfer with a reason and notifies the buyer', async () => {
    const buyer = await login(ctx, freshPhone());
    const payment = await purchase(ctx, buyer.token);

    const rejected = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/payments/${payment.id}/reject`,
      headers: auth(adminToken),
      payload: { reason: 'مبلغ واریز شده با مبلغ یکتا هم‌خوانی ندارد' },
    });
    expect(rejected.statusCode).toBe(200);
    expect(json<{ status: string }>(rejected).status).toBe('FAILED');

    const inbox = await ctx.app.inject({
      method: 'GET',
      url: '/v1/notifications',
      headers: auth(buyer.token),
    });
    const notification = json<{ items: { kind: string; bodyFa: string }[] }>(inbox).items.find(
      (item) => item.kind === 'PAYMENT_FAILED',
    );
    expect(notification?.bodyFa).toContain('۴۹٬۰۰۰ تومان');

    const again = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/payments/${payment.id}/confirm`,
      headers: auth(adminToken),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
    expect(json<{ error: { code: string } }>(again).error.code).toBe('PAYMENT_ALREADY_SETTLED');
  });

  it('manages destination cards and never returns the full number', async () => {
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/payment-cards',
      headers: auth(adminToken),
      payload: {
        cardNumber: '6104337712349876',
        holderName: 'پشتیبانی بنزین',
        bankName: 'بانک ملت',
        dailyLimit: 50_000_000,
      },
    });
    expect(created.statusCode).toBe(201);
    const card = json<{
      id: string;
      maskedNumber: string;
      last4: string;
      isActive: boolean;
    }>(created);
    expect(card.maskedNumber).toBe('•••• •••• •••• ۹۸۷۶');
    expect(card.last4).toBe('9876');
    expect(card.isActive).toBe(true);
    expect(created.body).not.toContain('6104337712349876');

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/v1/admin/payment-cards',
      headers: auth(adminToken),
    });
    expect(list.statusCode).toBe(200);
    const items = json<{ items: { cardNumber?: string; maskedNumber: string }[] }>(list).items;
    expect(items.every((row) => row.cardNumber === undefined)).toBe(true);
    expect(items.length).toBeGreaterThanOrEqual(2);

    const deactivated = await ctx.app.inject({
      method: 'POST',
      url: `/v1/admin/payment-cards/${card.id}/deactivate`,
      headers: auth(adminToken),
    });
    expect(deactivated.statusCode).toBe(200);
    expect(json<{ isActive: boolean }>(deactivated).isActive).toBe(false);

    const invalid = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/payment-cards',
      headers: auth(adminToken),
      payload: { cardNumber: '123', holderName: 'کوتاه' },
    });
    expect(invalid.statusCode).toBe(422);
  });

  it('runs reconciliation on demand', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/v1/admin/reconciliation',
      headers: auth(adminToken),
    });
    expect(response.statusCode).toBe(200);
    const report = json<{
      expiredPayments: number;
      healedPayments: number;
      expiredSubscriptions: number;
    }>(response);
    expect(typeof report.expiredPayments).toBe('number');
    expect(report.healedPayments).toBeGreaterThanOrEqual(0);
  });

  it('keeps billing endpoints away from normal users', async () => {
    const user = await login(ctx, freshPhone());
    for (const [method, url] of [
      ['GET', '/v1/admin/payments'],
      ['GET', '/v1/admin/payment-cards'],
      ['POST', '/v1/admin/reconciliation'],
    ] as const) {
      const response = await ctx.app.inject({ method, url, headers: auth(user.token) });
      expect(response.statusCode).toBe(403);
    }
  });
});
