import { randomUUID } from 'node:crypto';
import type { ReputationEvent, TradeRating } from '../../domain/entities.js';
import type { NewReputationEvent, NewTradeRating, ReputationRepository } from '../../ports.js';

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory trust store: append-only events plus one rating per rater per trade. */
export class MemoryReputationRepository implements ReputationRepository {
  private readonly events: ReputationEvent[] = [];
  private readonly ratings = new Map<string, TradeRating>();

  private ratingKey(reservationId: string, raterId: string): string {
    return `${reservationId}:${raterId}`;
  }

  async append(input: NewReputationEvent, at: Date): Promise<ReputationEvent> {
    const event: ReputationEvent = {
      id: randomUUID(),
      userId: input.userId,
      kind: input.kind,
      delta: input.delta,
      orderId: input.orderId,
      metadata: input.metadata,
      createdAt: at,
    };
    this.events.push(clone(event));
    return clone(event);
  }

  async listByUser(
    userId: string,
    options: { since: Date | null; limit: number },
  ): Promise<ReputationEvent[]> {
    return this.events
      .filter((event) => event.userId === userId)
      .filter((event) => options.since === null || event.createdAt >= options.since)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit)
      .map(clone);
  }

  async listRatingsFor(userId: string, limit: number): Promise<TradeRating[]> {
    return [...this.ratings.values()]
      .filter((rating) => rating.subjectId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(clone);
  }

  async findRating(reservationId: string, raterId: string): Promise<TradeRating | null> {
    const rating = this.ratings.get(this.ratingKey(reservationId, raterId));
    return rating ? clone(rating) : null;
  }

  async createRating(input: NewTradeRating, at: Date): Promise<TradeRating | null> {
    const key = this.ratingKey(input.reservationId, input.raterId);
    if (this.ratings.has(key)) return null;
    const rating: TradeRating = {
      id: randomUUID(),
      reservationId: input.reservationId,
      raterId: input.raterId,
      subjectId: input.subjectId,
      stars: input.stars,
      comment: input.comment,
      createdAt: at,
    };
    this.ratings.set(key, clone(rating));
    return clone(rating);
  }
}
