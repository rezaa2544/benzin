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

  async listAll(options: { status: Payment['status'] | null; limit: number }): Promise<Payment[]> {
    return [...this.byId.values()]
      .filter((payment) => options.status === null || payment.status === options.status)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit)
      .map(clone);
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
