import {
  AppError,
  RATEABLE_RESERVATION_STATUSES,
  REPUTATION_DELTAS,
  REPUTATION_EVENT_FA,
  REPUTATION_LEVEL_FA,
  ratingEventKind,
  reputationLevel,
  reputationScore,
  type RatingInput,
  type ReputationEventKind,
  type ReputationLevel,
} from '@benzin/shared';
import type { Clock, ReputationEvent, Reservation, TradeRating, User } from '../domain/entities.js';
import type { NotificationEmitter, Repositories } from '../ports.js';
import type { SettingsService } from './settings-service.js';

export interface ReputationEventView {
  id: string;
  kind: ReputationEventKind;
  labelFa: string;
  delta: number;
  orderId: string | null;
  createdAt: string;
}

export interface ReputationSummary {
  userId: string;
  score: number;
  level: ReputationLevel;
  levelFa: string;
  completedTrades: number;
  cancelledTrades: number;
  disputes: number;
  ratingCount: number;
  averageStars: number | null;
  suspendedUntil: string | null;
  recentEvents: ReputationEventView[];
}

export interface RatingView {
  id: string;
  reservationId: string;
  raterId: string;
  subjectId: string;
  stars: number;
  comment: string | null;
  createdAt: string;
}

const toEventView = (event: ReputationEvent): ReputationEventView => ({
  id: event.id,
  kind: event.kind,
  labelFa: REPUTATION_EVENT_FA[event.kind],
  delta: event.delta,
  orderId: event.orderId,
  createdAt: event.createdAt.toISOString(),
});

const toRatingView = (rating: TradeRating): RatingView => ({
  id: rating.id,
  reservationId: rating.reservationId,
  raterId: rating.raterId,
  subjectId: rating.subjectId,
  stars: rating.stars,
  comment: rating.comment,
  createdAt: rating.createdAt.toISOString(),
});

/**
 * Trust service (tasks E6-01…E6-03).
 *
 * Every trade outcome appends a `reputation_events` row; the score is a projection, so a
 * moderator can always explain a number by replaying the history. Falling below
 * `trust.suspend_below_score` suspends the account for `trust.suspend_hours` — the
 * scheduler lifts it again (see `liftDueSuspensions`).
 */
export class ReputationService {
  constructor(
    private readonly repos: Pick<
      Repositories,
      'users' | 'orders' | 'reservations' | 'reputation' | 'audit'
    >,
    private readonly settings: SettingsService,
    private readonly clock: Clock,
    private readonly notifier: NotificationEmitter,
  ) {}

  /**
   * Records one trust event, then re-evaluates the account. Callers pass the delta from
   * `REPUTATION_DELTAS` so the weights stay in one place.
   */
  async record(input: {
    userId: string;
    kind: ReputationEventKind;
    orderId?: string | null;
    metadata?: Record<string, unknown>;
    delta?: number;
  }): Promise<{ score: number; suspended: boolean }> {
    const now = this.clock.now();
    const delta = input.delta ?? REPUTATION_DELTAS[input.kind];
    await this.repos.reputation.append(
      {
        userId: input.userId,
        kind: input.kind,
        delta,
        orderId: input.orderId ?? null,
        metadata: { ...(input.metadata ?? {}), kind: input.kind },
      },
      now,
    );
    const summary = await this.summary(input.userId);
    const suspended = await this.enforceSuspension(input.userId, summary.score);
    return { score: summary.score, suspended };
  }

  /** One rating per party per trade, only after the hand-over happened (E6-03). */
  async rate(actor: User, reservationId: string, input: RatingInput): Promise<RatingView> {
    const reservation = await this.repos.reservations.findById(reservationId);
    if (!reservation) {
      throw AppError.notFound('RESERVATION_NOT_FOUND', 'Reservation not found');
    }
    const order = await this.repos.orders.findById(reservation.orderId);
    if (!order) throw AppError.notFound('ORDER_NOT_AVAILABLE', 'Order not found');

    const isOwner = order.ownerId === actor.id;
    const isTaker = reservation.takerId === actor.id;
    if (!isOwner && !isTaker) {
      throw AppError.forbidden('NOT_RESERVATION_PARTY', 'Not a party to this trade');
    }
    if (!RATEABLE_RESERVATION_STATUSES.includes(reservation.status as 'COMPLETED')) {
      throw new AppError('INVALID_STATE_TRANSITION', 409, 'The trade is not finished yet', {
        status: reservation.status,
      });
    }

    const subjectId = isOwner ? reservation.takerId : order.ownerId;
    const existing = await this.repos.reputation.findRating(reservationId, actor.id);
    if (existing) {
      throw new AppError('ALREADY_RATED', 409, 'You already rated this trade', {
        ratingId: existing.id,
      });
    }

    const kind = ratingEventKind(input.stars);
    const rating = await this.repos.reputation.createRating(
      {
        reservationId,
        raterId: actor.id,
        subjectId,
        stars: input.stars,
        comment: input.comment ?? null,
      },
      this.clock.now(),
    );
    if (!rating) throw new AppError('ALREADY_RATED', 409, 'You already rated this trade');

    await this.repos.audit.append({
      actorId: actor.id,
      action: 'reputation.rated',
      entity: 'reservation',
      entityId: reservationId,
      metadata: { subjectId, stars: input.stars, kind },
    });

    const result = await this.record({
      userId: subjectId,
      kind,
      orderId: order.id,
      metadata: { reservationId, stars: input.stars, raterId: actor.id },
    });

    await this.notifier.emit({
      userId: subjectId,
      kind: 'RATING_RECEIVED',
      params: { stars: input.stars, score: result.score },
      payload: { reservationId, orderId: order.id, stars: input.stars },
    });

    return toRatingView(rating);
  }

  async summary(userId: string): Promise<ReputationSummary> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw AppError.notFound('NOT_FOUND', 'User not found');
    const config = await this.settings.get();
    const since = new Date(
      this.clock.now().getTime() - config['trust.window_days'] * 24 * 3_600_000,
    );
    const events = await this.repos.reputation.listByUser(userId, { since, limit: 500 });
    const ratings = await this.repos.reputation.listRatingsFor(userId, 500);
    const score = reputationScore(events);
    const level = reputationLevel(score);
    return {
      userId,
      score,
      level,
      levelFa: REPUTATION_LEVEL_FA[level],
      completedTrades: events.filter(
        (event) => event.kind === 'TRADE_COMPLETED' || event.kind === 'TRADE_AUTO_COMPLETED',
      ).length,
      cancelledTrades: events.filter(
        (event) => event.kind === 'TAKER_CANCELLED' || event.kind === 'OWNER_CANCELLED',
      ).length,
      disputes: events.filter((event) => event.kind === 'DISPUTE_OPENED').length,
      ratingCount: ratings.length,
      averageStars:
        ratings.length === 0
          ? null
          : Math.round(
              (ratings.reduce((sum, rating) => sum + rating.stars, 0) / ratings.length) * 10,
            ) / 10,
      suspendedUntil: user.suspendedUntil?.toISOString() ?? null,
      recentEvents: events.slice(0, 20).map(toEventView),
    };
  }

  /** Public card: score and level only — never the private event history. */
  async publicProfile(
    userId: string,
  ): Promise<{ userId: string; score: number; level: ReputationLevel; levelFa: string }> {
    const summary = await this.summary(userId);
    return {
      userId: summary.userId,
      score: summary.score,
      level: summary.level,
      levelFa: summary.levelFa,
    };
  }

  private async enforceSuspension(userId: string, score: number): Promise<boolean> {
    const config = await this.settings.get();
    if (score >= config['trust.suspend_below_score']) return false;

    const user = await this.repos.users.findById(userId);
    if (!user || user.status !== 'ACTIVE') return false;

    const now = this.clock.now();
    user.status = 'SUSPENDED';
    user.suspendedUntil = new Date(now.getTime() + config['trust.suspend_hours'] * 3_600_000);
    await this.repos.users.save(user);

    await this.repos.audit.append({
      actorId: null,
      action: 'user.suspended',
      entity: 'user',
      entityId: userId,
      metadata: { score, until: user.suspendedUntil.toISOString() },
    });
    await this.notifier.emit({
      userId,
      kind: 'ACCOUNT_SUSPENDED',
      params: { score, hours: config['trust.suspend_hours'] },
      payload: { score },
    });
    return true;
  }

  /** Scheduler sweep: restore accounts whose suspension window elapsed (E6-01). */
  async liftDueSuspensions(limit = 100): Promise<number> {
    const due = await this.repos.users.listSuspendedDue(this.clock.now(), limit);
    let lifted = 0;
    for (const user of due) {
      user.status = 'ACTIVE';
      user.suspendedUntil = null;
      await this.repos.users.save(user);
      await this.repos.reputation.append(
        {
          userId: user.id,
          kind: 'SUSPENSION_LIFTED',
          delta: REPUTATION_DELTAS.SUSPENSION_LIFTED,
          orderId: null,
          metadata: { kind: 'SUSPENSION_LIFTED' },
        },
        this.clock.now(),
      );
      await this.repos.audit.append({
        actorId: null,
        action: 'user.suspension_lifted',
        entity: 'user',
        entityId: user.id,
        metadata: {},
      });
      const summary = await this.summary(user.id);
      await this.notifier.emit({
        userId: user.id,
        kind: 'ACCOUNT_RESTORED',
        params: { score: summary.score },
        payload: { score: summary.score },
      });
      lifted += 1;
    }
    return lifted;
  }

  /** Convenience used by the reservation lifecycle to keep call sites short. */
  async recordTradeOutcome(
    reservation: Reservation,
    ownerId: string,
    kind: ReputationEventKind,
  ): Promise<void> {
    const targets = new Set([ownerId, reservation.takerId]);
    for (const userId of targets) {
      await this.record({ userId, kind, orderId: reservation.orderId });
    }
  }
}
