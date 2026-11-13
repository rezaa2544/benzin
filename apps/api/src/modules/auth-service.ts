import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { AppError, type UserRole } from '@benzin/shared';
import type { User } from '../domain/entities.js';
import type { Repositories, SmsSender } from '../ports.js';
import type { Clock } from '../domain/entities.js';
import type { SettingsService } from './settings-service.js';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};

export interface SessionResult {
  token: string;
  expiresAt: Date;
  user: User;
  isNewUser: boolean;
}

export class AuthService {
  constructor(
    private readonly repos: Repositories,
    private readonly settings: SettingsService,
    private readonly sms: SmsSender,
    private readonly clock: Clock,
    private readonly pepper: string,
  ) {}

  private hash(code: string, phone: string): string {
    return sha256(`${this.pepper}:${phone}:${code}`);
  }

  /** Issues a one-time code. Cooldown and TTL are runtime settings, not constants. */
  async requestOtp(phone: string): Promise<{ expiresAt: Date; cooldownSeconds: number }> {
    const config = await this.settings.get();
    const now = this.clock.now();
    const existing = await this.repos.otps.findLatest(phone);

    if (existing && existing.consumedAt === null) {
      const earliest = existing.sentAt.getTime() + config['otp.resend_cooldown_seconds'] * 1000;
      if (now.getTime() < earliest) {
        throw new AppError('RATE_LIMITED', 429, 'OTP requested too recently', {
          retryAfterSeconds: Math.ceil((earliest - now.getTime()) / 1000),
        });
      }
    }

    const code = String(randomInt(0, 10 ** config['otp.length'])).padStart(
      config['otp.length'],
      '0',
    );
    const expiresAt = new Date(now.getTime() + config['otp.ttl_seconds'] * 1000);
    await this.repos.otps.save({
      phone,
      codeHash: this.hash(code, phone),
      expiresAt,
      attempts: 0,
      sentAt: now,
      consumedAt: null,
    });
    await this.sms.send(phone, `کد ورود شما به بنزین: ${code}`);
    return { expiresAt, cooldownSeconds: config['otp.resend_cooldown_seconds'] };
  }

  async verifyOtp(phone: string, code: string): Promise<SessionResult> {
    const config = await this.settings.get();
    const now = this.clock.now();
    const challenge = await this.repos.otps.findLatest(phone);

    if (!challenge || challenge.consumedAt !== null) {
      throw new AppError('OTP_EXPIRED', 410, 'No active code for this phone');
    }
    if (challenge.expiresAt.getTime() <= now.getTime()) {
      throw new AppError('OTP_EXPIRED', 410, 'Code expired');
    }
    if (challenge.attempts >= config['otp.max_attempts']) {
      throw new AppError('OTP_ATTEMPTS_EXCEEDED', 429, 'Too many attempts');
    }
    if (!safeEqual(this.hash(code, phone), challenge.codeHash)) {
      await this.repos.otps.save({ ...challenge, attempts: challenge.attempts + 1 });
      throw new AppError('OTP_INVALID', 401, 'Wrong code', {
        remainingAttempts: Math.max(0, config['otp.max_attempts'] - challenge.attempts - 1),
      });
    }

    await this.repos.otps.save({ ...challenge, consumedAt: now });

    let user = await this.repos.users.findByPhone(phone);
    const isNewUser = user === null;
    if (!user) user = await this.repos.users.create({ phone });
    if (user.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Account is not active');

    const session = await this.repos.sessions.create(
      user.id,
      new Date(now.getTime() + config['auth.refresh_token_days'] * 24 * 60 * 60 * 1000),
    );
    await this.repos.audit.append({
      actorId: user.id,
      action: isNewUser ? 'auth.registered' : 'auth.login',
      entity: 'user',
      entityId: user.id,
      metadata: { phone },
    });

    return { token: session.token, expiresAt: session.expiresAt, user, isNewUser };
  }

  async authenticate(token: string): Promise<User> {
    const session = await this.repos.sessions.find(token);
    if (!session || session.revokedAt !== null) throw AppError.unauthorized('Invalid session');
    if (session.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw AppError.unauthorized('Session expired');
    }
    const user = await this.repos.users.findById(session.userId);
    if (!user) throw AppError.unauthorized('Unknown user');
    if (user.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Account is not active');
    return user;
  }

  async logout(token: string): Promise<void> {
    await this.repos.sessions.revoke(token);
  }
}

export function assertRole(user: User, roles: readonly UserRole[]): void {
  if (!roles.includes(user.role)) throw AppError.forbidden();
}
