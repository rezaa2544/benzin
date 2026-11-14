import { AppError, type ReputationLevel, type UpdateProfileInput } from '@benzin/shared';
import type { User } from '../domain/entities.js';
import type { Repositories } from '../ports.js';
import type { ReputationService } from './reputation-service.js';

/**
 * What a stranger may know about a user (task E1-05): the name they chose, when they joined
 * and the trust card. Never the phone, the status or the moderation history.
 */
export interface PublicProfileView {
  id: string;
  displayName: string | null;
  memberSince: string;
  score: number;
  level: ReputationLevel;
  levelFa: string;
  completedTrades: number;
  ratingCount: number;
  averageStars: number | null;
}

/**
 * Self-service profile. Reading `/v1/me` is already covered by the auth guard, so this
 * service only owns the editable field and the public card.
 */
export class ProfileService {
  constructor(
    private readonly repos: Pick<Repositories, 'users' | 'audit'>,
    private readonly reputation: ReputationService,
  ) {}

  /** Renames the caller. `null` clears the name, which the UI shows as "کاربر بنزین". */
  async update(actor: User, input: UpdateProfileInput): Promise<User> {
    const user = await this.repos.users.findById(actor.id);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
    if (user.status === 'BANNED') {
      throw AppError.forbidden('ACCOUNT_SUSPENDED', 'This account cannot be edited');
    }

    const before = user.displayName;
    user.displayName = input.displayName;
    const saved = await this.repos.users.save(user);

    await this.repos.audit.append({
      actorId: actor.id,
      action: 'user.profile_updated',
      entity: 'user',
      entityId: user.id,
      metadata: { before, after: input.displayName },
    });

    return saved;
  }

  async publicProfile(userId: string): Promise<PublicProfileView> {
    const user = await this.repos.users.findById(userId);
    if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found');
    const summary = await this.reputation.summary(userId);
    return {
      id: user.id,
      displayName: user.displayName,
      memberSince: user.createdAt.toISOString(),
      score: summary.score,
      level: summary.level,
      levelFa: summary.levelFa,
      completedTrades: summary.completedTrades,
      ratingCount: summary.ratingCount,
      averageStars: summary.averageStars,
    };
  }
}
