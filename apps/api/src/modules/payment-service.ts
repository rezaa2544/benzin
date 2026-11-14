import {
  AppError,
  formatJalaliDate,
  formatToman,
  toPersianDigits,
  type CreatePaymentCardInput,
  type GatewayCallbackInput,
  type PaymentStatus,
  type PurchaseSubscriptionInput,
} from '@benzin/shared';
import type { Clock, Payment, Plan, Subscription, User } from '../domain/entities.js';
import type { NotificationEmitter, PaymentProvider, Repositories } from '../ports.js';
import type { SettingsService } from './settings-service.js';

export interface PlanView {
  id: string;
  code: string;
  nameFa: string;
  priceToman: number;
  priceLabelFa: string;
  durationDays: number;
  maxActiveOrders: number;
}

export interface SubscriptionView {
  id: string;
  planId: string;
  planCode: string;
  planNameFa: string;
  status: Subscription['status'];
  startsAt: string;
  endsAt: string;
  daysRemaining: number | null;
}

export interface PaymentView {
  id: string;
  provider: Payment['provider'];
  status: Payment['status'];
  amountToman: number;
  uniqueAmountToman: number | null;
  amountLabelFa: string;
  reference: string | null;
  paidAt: string | null;
  expiresAt: string;
  createdAt: string;
}

export interface PaymentStartView extends PaymentView {
  /** Gateway redirect (GATEWAY) or null for card-to-card. */
  redirectUrl: string | null;
  /** Card the payer must transfer to (card-to-card only, already masked upstream). */
  destination: { cardNumber: string; holderName: string; bankName: string | null } | null;
  /** Persian instruction line the client renders verbatim. */
  instructionFa: string;
}

export interface PaymentCardView {
  id: string;
  /** Never the full number: 6037 •••• •••• 7890 (E7-07). */
  maskedNumber: string;
  last4: string;
  holderName: string;
  bankName: string | null;
  isActive: boolean;
  dailyLimit: number | null;
}

export interface ReconciliationReport {
  expiredPayments: number;
  healedPayments: number;
  expiredSubscriptions: number;
}

const toPlanView = (plan: Plan): PlanView => ({
  id: plan.id,
  code: plan.code,
  nameFa: plan.nameFa,
  priceToman: plan.priceToman,
  priceLabelFa: formatToman(plan.priceToman),
  durationDays: plan.durationDays,
  maxActiveOrders: plan.maxActiveOrders,
});

const toPaymentView = (payment: Payment): PaymentView => ({
  id: payment.id,
  provider: payment.provider,
  status: payment.status,
  amountToman: payment.amountToman,
  uniqueAmountToman: payment.uniqueAmountToman,
  amountLabelFa: formatToman(payment.uniqueAmountToman ?? payment.amountToman),
  reference: payment.reference,
  paidAt: payment.paidAt?.toISOString() ?? null,
  expiresAt: payment.expiresAt.toISOString(),
  createdAt: payment.createdAt.toISOString(),
});

/** Masks a card number for every API response and log line. */
export const maskCardNumber = (cardNumber: string): string => {
  const digits = cardNumber.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return toPersianDigits(`•••• •••• •••• ${last4}`);
};

const toCardView = (card: {
  id: string;
  cardNumber: string;
  holderName: string;
  bankName: string | null;
  isActive: boolean;
  dailyLimit: number | null;
}): PaymentCardView => ({
  id: card.id,
  maskedNumber: maskCardNumber(card.cardNumber),
  last4: card.cardNumber.replace(/\D/g, '').slice(-4),
  holderName: card.holderName,
  bankName: card.bankName,
  isActive: card.isActive,
  dailyLimit: card.dailyLimit,
});

/**
 * Plans, subscriptions and payments (tasks E7-01, E7-02, E7-06).
 *
 * Money is integer Toman everywhere. A purchase creates a PENDING subscription plus a
 * PENDING payment; the subscription only becomes ACTIVE when a provider (or an operator)
 * proves the money arrived, and `reconcile()` is the safety net for the cases in between.
 */
export class PaymentService {
  constructor(
    private readonly repos: Pick<
      Repositories,
      'plans' | 'subscriptions' | 'payments' | 'paymentCards' | 'audit'
    >,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly providers: { gateway: PaymentProvider; cardToCard: PaymentProvider },
    private readonly notifier: NotificationEmitter,
  ) {}

  private providerFor(kind: Payment['provider']): PaymentProvider {
    return kind === 'GATEWAY' ? this.providers.gateway : this.providers.cardToCard;
  }

  async listPlans(): Promise<{ items: PlanView[] }> {
    const plans = await this.repos.plans.listActive();
    return { items: plans.map(toPlanView) };
  }

  async currentSubscription(user: User): Promise<{ subscription: SubscriptionView | null }> {
    const now = this.clock.now();
    const subscription = await this.repos.subscriptions.findActiveByUser(user.id, now);
    if (!subscription) return { subscription: null };
    return { subscription: await this.toSubscriptionView(subscription) };
  }

  private async toSubscriptionView(subscription: Subscription): Promise<SubscriptionView> {
    const plan = await this.repos.plans.findById(subscription.planId);
    const remainingMs = subscription.endsAt.getTime() - this.clock.now().getTime();
    return {
      id: subscription.id,
      planId: subscription.planId,
      planCode: plan?.code ?? '',
      planNameFa: plan?.nameFa ?? '',
      status: subscription.status,
      startsAt: subscription.startsAt.toISOString(),
      endsAt: subscription.endsAt.toISOString(),
      daysRemaining: remainingMs > 0 ? Math.ceil(remainingMs / 86_400_000) : 0,
    };
  }

  /** Creates the subscription + payment and asks the chosen provider how to pay. */
  async startPurchase(user: User, input: PurchaseSubscriptionInput): Promise<PaymentStartView> {
    const plan = await this.repos.plans.findByCode(input.planCode);
    if (!plan || !plan.isActive) {
      throw AppError.notFound('PLAN_NOT_FOUND', 'Plan is not available');
    }
    const config = await this.settings.get();
    const now = this.clock.now();
    const ttlMinutes =
      input.method === 'GATEWAY'
        ? config['payment.gateway_ttl_minutes']
        : config['payment.card_to_card_ttl_minutes'];

    const subscription = await this.repos.subscriptions.create({
      userId: user.id,
      planId: plan.id,
      startsAt: now,
      endsAt: new Date(now.getTime() + plan.durationDays * 86_400_000),
    });

    const payment = await this.createPaymentWithUniqueAmount({
      userId: user.id,
      subscriptionId: subscription.id,
      provider: input.method,
      amountToman: plan.priceToman,
      expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
      suffixMax: config['payment.unique_suffix_max'],
      method: input.method,
    });

    const provider = this.providerFor(input.method);
    const init = await provider.init({
      paymentId: payment.id,
      amountToman: plan.priceToman,
      uniqueAmountToman: payment.uniqueAmountToman,
      descriptionFa: `خرید ${plan.nameFa}`,
    });
    if (init.authority) {
      await this.repos.payments.transition(payment.id, 'PENDING', 'PENDING', {
        authority: init.authority,
      });
    }

    await this.repos.audit.append({
      actorId: user.id,
      action: 'payment.created',
      entity: 'payment',
      entityId: payment.id,
      metadata: {
        method: input.method,
        planCode: plan.code,
        amountToman: plan.priceToman,
        uniqueAmountToman: payment.uniqueAmountToman,
      },
    });

    const settled = (await this.repos.payments.findById(payment.id)) ?? payment;
    return {
      ...toPaymentView(settled),
      redirectUrl: init.redirectUrl,
      destination: init.destination,
      instructionFa:
        input.method === 'GATEWAY'
          ? 'برای پرداخت آنلاین به درگاه منتقل می‌شوید.'
          : `مبلغ ${formatToman(settled.uniqueAmountToman ?? settled.amountToman)} را به کارت بالا واریز کنید؛ مبلغ یکتا برای تأیید خودکار لازم است.`,
    };
  }

  /**
   * Card-to-card needs an amount nobody else is currently paying, otherwise an operator
   * cannot tell the transfers apart. Collisions retry with a fresh suffix.
   */
  private async createPaymentWithUniqueAmount(input: {
    userId: string;
    subscriptionId: string;
    provider: Payment['provider'];
    amountToman: number;
    expiresAt: Date;
    suffixMax: number;
    method: PurchaseSubscriptionInput['method'];
  }): Promise<Payment> {
    const now = this.clock.now();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const uniqueAmountToman =
        input.method === 'CARD_TO_CARD'
          ? input.amountToman + 1 + Math.floor(Math.random() * input.suffixMax)
          : null;
      const payment = await this.repos.payments.create(
        {
          userId: input.userId,
          subscriptionId: input.subscriptionId,
          provider: input.provider,
          amountToman: input.amountToman,
          uniqueAmountToman,
          expiresAt: input.expiresAt,
        },
        now,
      );
      if (payment) return payment;
    }
    throw AppError.conflict('CONFLICT', 'Could not allocate a unique amount, try again');
  }

  async getPayment(user: User, id: string): Promise<PaymentView> {
    const payment = await this.repos.payments.findById(id);
    if (!payment || (payment.userId !== user.id && user.role === 'USER')) {
      throw AppError.notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    }
    return toPaymentView(payment);
  }

  async listMine(user: User, limit = 20): Promise<{ items: PaymentView[] }> {
    const payments = await this.repos.payments.listByUser(user.id, limit);
    return { items: payments.map(toPaymentView) };
  }

  /** Gateway callback: verify with the provider, then settle (task E7-03). */
  async handleGatewayCallback(
    user: User,
    paymentId: string,
    input: GatewayCallbackInput,
  ): Promise<{ payment: PaymentView; subscription: SubscriptionView | null }> {
    const payment = await this.loadPayable(user, paymentId, 'GATEWAY');
    const provider = this.providerFor('GATEWAY');
    const result = await provider.verify({
      paymentId: payment.id,
      amountToman: payment.amountToman,
      authority: input.authority ?? payment.authority,
      reference: input.reference ?? null,
    });

    if (!result.ok) {
      await this.repos.payments.transition(payment.id, 'PENDING', 'FAILED', {
        reference: result.reason,
      });
      await this.repos.audit.append({
        actorId: user.id,
        action: 'payment.failed',
        entity: 'payment',
        entityId: payment.id,
        metadata: { reason: result.reason },
      });
      throw new AppError('PAYMENT_VERIFICATION_FAILED', 409, 'Payment was not confirmed', {
        reason: result.reason,
      });
    }

    return this.settle(payment, result.reference, user.id);
  }

  private async loadPayable(
    user: User,
    paymentId: string,
    method: Payment['provider'],
  ): Promise<Payment> {
    const payment = await this.repos.payments.findById(paymentId);
    if (!payment || payment.userId !== user.id) {
      throw AppError.notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    }
    if (payment.provider !== method) {
      throw new AppError('PAYMENT_NOT_PAYABLE', 409, 'Payment belongs to another method');
    }
    if (payment.status !== 'PENDING') {
      throw new AppError('PAYMENT_ALREADY_SETTLED', 409, 'Payment is already settled', {
        status: payment.status,
      });
    }
    if (payment.expiresAt.getTime() <= this.clock.now().getTime()) {
      await this.repos.payments.transition(payment.id, 'PENDING', 'EXPIRED');
      throw new AppError('PAYMENT_ALREADY_SETTLED', 409, 'Payment window elapsed');
    }
    return payment;
  }

  /** Marks the payment PAID, activates the subscription and notifies the buyer. */
  private async settle(
    payment: Payment,
    reference: string | null,
    actorId: string | null,
    nextStatus: Payment['status'] = 'PAID',
  ): Promise<{ payment: PaymentView; subscription: SubscriptionView | null }> {
    const now = this.clock.now();
    const updated = await this.repos.payments.transition(payment.id, 'PENDING', nextStatus, {
      paidAt: now,
      reference,
    });
    if (!updated) {
      throw new AppError('PAYMENT_ALREADY_SETTLED', 409, 'Payment changed while settling');
    }

    let subscription: SubscriptionView | null = null;
    if (updated.subscriptionId) {
      const pending = await this.repos.subscriptions.findById(updated.subscriptionId);
      const plan = pending ? await this.repos.plans.findById(pending.planId) : null;
      if (pending && plan) {
        const activated = await this.repos.subscriptions.activate(
          pending.id,
          now,
          new Date(now.getTime() + plan.durationDays * 86_400_000),
        );
        if (activated) {
          subscription = await this.toSubscriptionView(activated);
          await this.notifier.emit({
            userId: updated.userId,
            kind: 'PAYMENT_APPROVED',
            params: {
              amount: updated.amountToman,
              plan: plan.nameFa,
              endsAt: formatJalaliDate(activated.endsAt),
            },
            payload: { paymentId: updated.id, subscriptionId: activated.id },
          });
        }
      }
    }

    await this.repos.audit.append({
      actorId,
      action: 'payment.paid',
      entity: 'payment',
      entityId: updated.id,
      metadata: { reference, provider: updated.provider, amountToman: updated.amountToman },
    });

    return { payment: toPaymentView(updated), subscription };
  }

  /** Operator confirmation for a card-to-card transfer (task E7-07). */
  async confirmPayment(
    actor: User,
    paymentId: string,
    reference: string | null,
  ): Promise<{ payment: PaymentView; subscription: SubscriptionView | null }> {
    const payment = await this.repos.payments.findById(paymentId);
    if (!payment) throw AppError.notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    if (payment.status !== 'PENDING') {
      throw new AppError('PAYMENT_ALREADY_SETTLED', 409, 'Payment is already settled');
    }
    return this.settle(payment, reference ?? `MANUAL-${payment.id.slice(0, 8)}`, actor.id);
  }

  async rejectPayment(actor: User, paymentId: string, reason: string): Promise<PaymentView> {
    const payment = await this.repos.payments.findById(paymentId);
    if (!payment) throw AppError.notFound('PAYMENT_NOT_FOUND', 'Payment not found');
    const updated = await this.repos.payments.transition(payment.id, 'PENDING', 'FAILED', {
      reference: reason,
    });
    if (!updated) {
      throw new AppError('PAYMENT_ALREADY_SETTLED', 409, 'Payment is already settled');
    }
    await this.repos.audit.append({
      actorId: actor.id,
      action: 'payment.rejected',
      entity: 'payment',
      entityId: payment.id,
      metadata: { reason },
    });
    await this.notifier.emit({
      userId: payment.userId,
      kind: 'PAYMENT_FAILED',
      params: { amount: payment.amountToman },
      payload: { paymentId: payment.id, reason },
    });
    return toPaymentView(updated);
  }

  // ------------------------------------------------------- admin (E7-07)

  async listPaymentCards(): Promise<{ items: PaymentCardView[] }> {
    const cards = await this.repos.paymentCards.list(false);
    return { items: cards.map(toCardView) };
  }

  async addPaymentCard(actor: User, input: CreatePaymentCardInput): Promise<PaymentCardView> {
    const card = await this.repos.paymentCards.create(
      {
        cardNumber: input.cardNumber,
        holderName: input.holderName,
        bankName: input.bankName ?? null,
        dailyLimit: input.dailyLimit ?? null,
      },
      this.clock.now(),
    );
    await this.repos.audit.append({
      actorId: actor.id,
      action: 'payment_card.created',
      entity: 'payment_card',
      entityId: card.id,
      metadata: { last4: card.cardNumber.slice(-4), bankName: card.bankName },
    });
    return toCardView(card);
  }

  async deactivatePaymentCard(actor: User, id: string): Promise<PaymentCardView> {
    const card = await this.repos.paymentCards.deactivate(id);
    if (!card) throw AppError.notFound('NOT_FOUND', 'Card not found');
    await this.repos.audit.append({
      actorId: actor.id,
      action: 'payment_card.deactivated',
      entity: 'payment_card',
      entityId: card.id,
      metadata: { last4: card.cardNumber.slice(-4) },
    });
    return toCardView(card);
  }

  async listAllPayments(options: {
    status: PaymentStatus | null;
    limit: number;
  }): Promise<{ items: PaymentView[] }> {
    const payments = await this.repos.payments.listAll(options);
    return { items: payments.map(toPaymentView) };
  }

  /**
   * E7-06: the nightly safety net. Expired intents die, paid-but-inactive subscriptions
   * are activated, and finished subscriptions are closed — all idempotent.
   */
  async reconcile(limit = 200): Promise<ReconciliationReport> {
    const now = this.clock.now();
    let expiredPayments = 0;
    for (const payment of await this.repos.payments.listPendingExpired(now, limit)) {
      const updated = await this.repos.payments.transition(payment.id, 'PENDING', 'EXPIRED');
      if (updated) expiredPayments += 1;
    }

    let healedPayments = 0;
    const paid = await this.repos.payments.listAll({ status: 'PAID', limit });
    for (const payment of paid) {
      if (!payment.subscriptionId) continue;
      const subscription = await this.repos.subscriptions.findById(payment.subscriptionId);
      if (!subscription || subscription.status !== 'PENDING') continue;
      const plan = await this.repos.plans.findById(subscription.planId);
      if (!plan) continue;
      const activated = await this.repos.subscriptions.activate(
        subscription.id,
        payment.paidAt ?? now,
        new Date((payment.paidAt ?? now).getTime() + plan.durationDays * 86_400_000),
      );
      if (!activated) continue;
      healedPayments += 1;
      await this.repos.audit.append({
        actorId: null,
        action: 'payment.reconciled',
        entity: 'payment',
        entityId: payment.id,
        metadata: { subscriptionId: subscription.id },
      });
    }

    let expiredSubscriptions = 0;
    for (const subscription of await this.repos.subscriptions.listDueExpiry(now, limit)) {
      const expired = await this.repos.subscriptions.expire(subscription.id);
      if (!expired) continue;
      expiredSubscriptions += 1;
      const plan = await this.repos.plans.findById(subscription.planId);
      await this.notifier.emit({
        userId: subscription.userId,
        kind: 'SUBSCRIPTION_EXPIRED',
        params: { plan: plan?.nameFa ?? '' },
        payload: { subscriptionId: subscription.id },
      });
    }

    return { expiredPayments, healedPayments, expiredSubscriptions };
  }
}
