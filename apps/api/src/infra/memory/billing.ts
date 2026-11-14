import { randomUUID } from 'node:crypto';
import type { Payment, PaymentCard, Plan, Subscription } from '../../domain/entities.js';
import type {
  NewPayment,
  NewSubscription,
  PaymentCardRepository,
  PaymentRepository,
  PlanRepository,
  SubscriptionRepository,
} from '../../ports.js';

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory plan catalogue; seeded from `SEED_PLANS` on boot (task E7-01). */
export class MemoryPlanRepository implements PlanRepository {
  private readonly byId = new Map<string, Plan>();

  async listActive(): Promise<Plan[]> {
    return [...this.byId.values()]
      .filter((plan) => plan.isActive)
      .sort((a, b) => a.priceToman - b.priceToman)
      .map(clone);
  }

  async findById(id: string): Promise<Plan | null> {
    const plan = this.byId.get(id);
    return plan ? clone(plan) : null;
  }

  async findByCode(code: string): Promise<Plan | null> {
    const plan = [...this.byId.values()].find((candidate) => candidate.code === code);
    return plan ? clone(plan) : null;
  }

  async upsert(plan: Plan): Promise<Plan> {
    this.byId.set(plan.id, clone(plan));
    return clone(plan);
  }
}

export class MemorySubscriptionRepository implements SubscriptionRepository {
  private readonly byId = new Map<string, Subscription>();

  async create(input: NewSubscription): Promise<Subscription> {
    const subscription: Subscription = {
      id: randomUUID(),
      userId: input.userId,
      planId: input.planId,
      status: 'PENDING',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      createdAt: input.startsAt,
    };
    this.byId.set(subscription.id, clone(subscription));
    return clone(subscription);
  }

  async findById(id: string): Promise<Subscription | null> {
    const subscription = this.byId.get(id);
    return subscription ? clone(subscription) : null;
  }

  async findActiveByUser(userId: string, now: Date): Promise<Subscription | null> {
    const candidates = [...this.byId.values()]
      .filter(
        (subscription) =>
          subscription.userId === userId &&
          subscription.status === 'ACTIVE' &&
          subscription.endsAt.getTime() > now.getTime(),
      )
      .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
    return candidates[0] ? clone(candidates[0]) : null;
  }

  async activate(id: string, startsAt: Date, endsAt: Date): Promise<Subscription | null> {
    const subscription = this.byId.get(id);
    if (!subscription || subscription.status !== 'PENDING') return null;
    subscription.status = 'ACTIVE';
    subscription.startsAt = startsAt;
    subscription.endsAt = endsAt;
    return clone(subscription);
  }

  async listDueExpiry(now: Date, limit: number): Promise<Subscription[]> {
    return [...this.byId.values()]
      .filter(
        (subscription) =>
          subscription.status === 'ACTIVE' && subscription.endsAt.getTime() <= now.getTime(),
      )
      .slice(0, limit)
      .map(clone);
  }

  async expire(id: string): Promise<Subscription | null> {
    const subscription = this.byId.get(id);
    if (!subscription || subscription.status !== 'ACTIVE') return null;
    subscription.status = 'EXPIRED';
    return clone(subscription);
  }

  async listByUser(userId: string, limit: number): Promise<Subscription[]> {
    return [...this.byId.values()]
      .filter((subscription) => subscription.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async listAll(query: {
    status: Subscription['status'] | null;
    limit: number;
    offset: number;
  }): Promise<{ items: Subscription[]; total: number }> {
    const matches = [...this.byId.values()]
      .filter((subscription) => query.status === null || subscription.status === query.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: matches.slice(query.offset, query.offset + query.limit).map(clone),
      total: matches.length,
    };
  }

  async countByStatus(): Promise<Record<Subscription['status'], number>> {
    const counts = { PENDING: 0, ACTIVE: 0, EXPIRED: 0, CANCELLED: 0 } as Record<
      Subscription['status'],
      number
    >;
    for (const subscription of this.byId.values()) counts[subscription.status] += 1;
    return counts;
  }
}

export class MemoryPaymentRepository implements PaymentRepository {
  private readonly byId = new Map<string, Payment>();

  private conflictsWithPending(amountToman: number): boolean {
    return [...this.byId.values()].some(
      (payment) => payment.status === 'PENDING' && payment.uniqueAmountToman === amountToman,
    );
  }

  async create(input: NewPayment, at: Date): Promise<Payment | null> {
    if (input.uniqueAmountToman !== null && this.conflictsWithPending(input.uniqueAmountToman)) {
      return null;
    }
    const payment: Payment = {
      id: randomUUID(),
      userId: input.userId,
      subscriptionId: input.subscriptionId,
      provider: input.provider,
      status: 'PENDING',
      amountToman: input.amountToman,
      authority: null,
      reference: null,
      uniqueAmountToman: input.uniqueAmountToman,
      rawPayload: {},
      paidAt: null,
      expiresAt: input.expiresAt,
      createdAt: at,
    };
    this.byId.set(payment.id, clone(payment));
    return clone(payment);
  }

  async findById(id: string): Promise<Payment | null> {
    const payment = this.byId.get(id);
    return payment ? clone(payment) : null;
  }

  async findByAuthority(authority: string): Promise<Payment | null> {
    const payment = [...this.byId.values()].find((candidate) => candidate.authority === authority);
    return payment ? clone(payment) : null;
  }

  async findByUniqueAmount(amountToman: number): Promise<Payment | null> {
    const payment = [...this.byId.values()].find(
      (candidate) => candidate.uniqueAmountToman === amountToman,
    );
    return payment ? clone(payment) : null;
  }

  async transition(
    id: string,
    expected: Payment['status'],
    next: Payment['status'],
    patch: Partial<Pick<Payment, 'paidAt' | 'reference' | 'authority'>> = {},
  ): Promise<Payment | null> {
    const payment = this.byId.get(id);
    if (!payment || payment.status !== expected) return null;
    payment.status = next;
    if (patch.paidAt !== undefined) payment.paidAt = patch.paidAt;
    if (patch.reference !== undefined) payment.reference = patch.reference;
    if (patch.authority !== undefined) payment.authority = patch.authority;
    return clone(payment);
  }

  async listPendingExpired(now: Date, limit: number): Promise<Payment[]> {
    return [...this.byId.values()]
      .filter(
        (payment) => payment.status === 'PENDING' && payment.expiresAt.getTime() <= now.getTime(),
      )
      .slice(0, limit)
      .map(clone);
  }

  async listByUser(userId: string, limit: number): Promise<Payment[]> {
    return [...this.byId.values()]
      .filter((payment) => payment.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async listAll(options: {
    status: Payment['status'] | null;
    limit: number;
    offset?: number;
  }): Promise<Payment[]> {
    const start = options.offset ?? 0;
    return [...this.byId.values()]
      .filter((payment) => options.status === null || payment.status === options.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(start, start + options.limit)
      .map(clone);
  }

  async summary(since: Date): Promise<{
    paidCount: number;
    paidToman: number;
    pendingCount: number;
    failedCount: number;
    expiredCount: number;
  }> {
    const summary = {
      paidCount: 0,
      paidToman: 0,
      pendingCount: 0,
      failedCount: 0,
      expiredCount: 0,
    };
    for (const payment of this.byId.values()) {
      if (payment.status === 'PENDING') summary.pendingCount += 1;
      if (payment.status === 'FAILED') summary.failedCount += 1;
      if (payment.status === 'EXPIRED') summary.expiredCount += 1;
      if (
        payment.status === 'PAID' &&
        (payment.paidAt ?? payment.createdAt).getTime() >= since.getTime()
      ) {
        summary.paidCount += 1;
        summary.paidToman += payment.amountToman;
      }
    }
    return summary;
  }
}

export class MemoryPaymentCardRepository implements PaymentCardRepository {
  private readonly byId = new Map<string, PaymentCard>();

  async list(activeOnly: boolean): Promise<PaymentCard[]> {
    return [...this.byId.values()]
      .filter((card) => !activeOnly || card.isActive)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }

  async findById(id: string): Promise<PaymentCard | null> {
    const card = this.byId.get(id);
    return card ? clone(card) : null;
  }

  async create(
    input: Omit<PaymentCard, 'id' | 'createdAt' | 'isActive'>,
    at: Date,
  ): Promise<PaymentCard> {
    const card: PaymentCard = {
      id: randomUUID(),
      cardNumber: input.cardNumber,
      holderName: input.holderName,
      bankName: input.bankName,
      isActive: true,
      dailyLimit: input.dailyLimit,
      createdAt: at,
    };
    this.byId.set(card.id, clone(card));
    return clone(card);
  }

  async deactivate(id: string): Promise<PaymentCard | null> {
    const card = this.byId.get(id);
    if (!card) return null;
    card.isActive = false;
    return clone(card);
  }
}
