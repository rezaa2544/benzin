import { randomInt } from 'node:crypto';
import { AppError, type UserRole } from '@benzin/shared';
import type { Clock, User } from '../domain/entities.js';
import type { Repositories, SmsSender } from '../ports.js';
import { KeyedLock } from './keyed-lock.js';
import type { SettingsService } from './settings-service.js';
import {
  createRefreshToken,
  sha256,
  signAccessToken,
  verifyAccessToken,
  type TokenConfig,
} from './tokens.js';

const safeEqualHex = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1)
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
};

export interface DeviceInput {
  platform: 'android' | 'ios' | 'web';
  deviceId: string;
  pushToken?: string;
  appVersion?: string;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
  deviceId: string | null;
  isNewUser: boolean;
}

export class AuthService {
  /** Cooldown, attempt cap and code consumption are all read-then-write (E1-07). */
  private readonly otpLock = new KeyedLock();
  /** One refresh token must rotate exactly once, however many callers race (E1-07). */
  private readonly refreshLock = new KeyedLock();

  constructor(
    private readonly repos: Repositories,
    private readonly settings: SettingsService,
    private readonly sms: SmsSender,
    private readonly clock: Clock,
    private readonly tokens: TokenConfig,
    private readonly pepper: string,
  ) {}

  private hash(code: string, phone: string): string {
    return sha256(`${this.pepper}:${phone}:${code}`);
  }

  /** Issues a one-time code. Cooldown and TTL are runtime settings, not constants. */
  async requestOtp(phone: string): Promise<{ expiresAt: Date; cooldownSeconds: number }> {
    // Serialised per phone: a burst of requests must produce one SMS, not one per request.
    return this.otpLock.run(`otp:${phone}`, () => this.issueOtp(phone));
  }

  private async issueOtp(phone: string): Promise<{ expiresAt: Date; cooldownSeconds: number }> {
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
    const challenge = {
      phone,
      codeHash: this.hash(code, phone),
      expiresAt: new Date(now.getTime() + config['otp.ttl_seconds'] * 1000),
      attempts: 0,
      sentAt: now,
      consumedAt: null,
    };
    await this.repos.otps.save(challenge);
    try {
      // A code is not just another message: the port lets a provider deliver it through an
      // approved OTP template instead of free text (A36).
      await this.sms.sendCode(phone, code);
    } catch (error) {
      // Nothing reached the user, so the code must not sit there burning the resend cooldown:
      // marking it consumed retires it and lets the next request issue a fresh one immediately.
      await this.repos.otps.save({ ...challenge, consumedAt: now });
      throw error;
    }
    return {
      expiresAt: new Date(now.getTime() + config['otp.ttl_seconds'] * 1000),
      cooldownSeconds: config['otp.resend_cooldown_seconds'],
    };
  }

  async verifyOtp(phone: string, code: string, device?: DeviceInput): Promise<AuthSession> {
    // Same key as issueOtp: a parallel burst cannot spend more than max_attempts guesses, and a
    // correct code can only be consumed once.
    return this.otpLock.run(`otp:${phone}`, () => this.checkOtp(phone, code, device));
  }

  private async checkOtp(phone: string, code: string, device?: DeviceInput): Promise<AuthSession> {
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
    if (!safeEqualHex(this.hash(code, phone), challenge.codeHash)) {
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

    let deviceId: string | null = null;
    if (device) {
      const stored = await this.repos.devices.upsert({ ...device, userId: user.id }, now);
      deviceId = stored.id;
    }

    const session = await this.issueSession(user, deviceId, null);
    await this.repos.audit.append({
      actorId: user.id,
      action: isNewUser ? 'auth.registered' : 'auth.login',
      entity: 'user',
      entityId: user.id,
      metadata: { phone, deviceId },
    });
    return { ...session, user, isNewUser };
  }

  private async issueSession(
    user: User,
    deviceId: string | null,
    familyId: string | null,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    deviceId: string | null;
    recordId: string;
  }> {
    const config = await this.settings.get();
    const now = this.clock.now();
    const access = signAccessToken({ sub: user.id, role: user.role }, this.tokens, now);
    const refresh = createRefreshToken(config['auth.refresh_token_days'], now);

    const record = await this.repos.refreshTokens.create({
      userId: user.id,
      tokenHash: refresh.tokenHash,
      familyId: familyId ?? crypto.randomUUID(),
      deviceId,
      expiresAt: refresh.expiresAt,
    });

    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.expiresIn,
      deviceId,
      recordId: record.id,
    };
  }

  /**
   * Rotates a refresh token. Presenting a token that was already rotated means it leaked:
   * the whole family is revoked so neither the attacker nor the legitimate client can continue.
   */
  async refresh(rawToken: string): Promise<AuthSession> {
    const stored = await this.repos.refreshTokens.findByHash(sha256(rawToken));
    if (!stored) throw new AppError('REFRESH_TOKEN_INVALID', 401, 'Unknown refresh token');
    // Serialised per family, then re-read: the loser of a race sees the rotation and is treated as
    // a replayed token instead of forking the family into two live chains.
    return this.refreshLock.run(`family:${stored.familyId}`, () => this.rotateRefresh(rawToken));
  }

  private async rotateRefresh(rawToken: string): Promise<AuthSession> {
    const now = this.clock.now();
    const stored = await this.repos.refreshTokens.findByHash(sha256(rawToken));
    if (!stored) throw new AppError('REFRESH_TOKEN_INVALID', 401, 'Unknown refresh token');

    if (stored.revokedAt !== null && stored.replacedBy === null) {
      // Revoked deliberately (logout, admin action): not a security event.
      throw new AppError('REFRESH_TOKEN_INVALID', 401, 'Refresh token revoked');
    }
    if (stored.revokedAt !== null) {
      const revoked = await this.repos.refreshTokens.revokeFamily(stored.familyId, now);
      await this.repos.audit.append({
        actorId: stored.userId,
        action: 'auth.refresh_reuse_detected',
        entity: 'user',
        entityId: stored.userId,
        metadata: { familyId: stored.familyId, revoked },
      });
      throw new AppError(
        'REFRESH_TOKEN_REUSED',
        401,
        'Refresh token reuse detected; session revoked',
      );
    }
    if (stored.expiresAt.getTime() <= now.getTime()) {
      throw new AppError('REFRESH_TOKEN_INVALID', 401, 'Refresh token expired');
    }

    const user = await this.repos.users.findById(stored.userId);
    if (!user) throw new AppError('REFRESH_TOKEN_INVALID', 401, 'Unknown user');
    if (user.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Account is not active');

    const next = await this.issueSession(user, stored.deviceId, stored.familyId);
    await this.repos.refreshTokens.revoke(stored.id, next.recordId, now);

    return {
      accessToken: next.accessToken,
      refreshToken: next.refreshToken,
      expiresIn: next.expiresIn,
      user,
      deviceId: stored.deviceId,
      isNewUser: false,
    };
  }

  /** Revokes the family the given refresh token belongs to (logout of one device). */
  async logout(rawToken: string): Promise<number> {
    const stored = await this.repos.refreshTokens.findByHash(sha256(rawToken));
    if (!stored) return 0;
    return this.repos.refreshTokens.revokeFamily(stored.familyId, this.clock.now());
  }

  async logoutAll(user: User): Promise<number> {
    const revoked = await this.repos.refreshTokens.revokeAllForUser(user.id, this.clock.now());
    await this.repos.audit.append({
      actorId: user.id,
      action: 'auth.logout_all',
      entity: 'user',
      entityId: user.id,
      metadata: { revoked },
    });
    return revoked;
  }

  /**
   * Verifies a short-lived access token and re-reads the user, so a role change or a
   * suspension takes effect immediately instead of after the token expires.
   */
  async authenticate(accessToken: string): Promise<User> {
    const claims = verifyAccessToken(accessToken, this.tokens, this.clock.now());
    const user = await this.repos.users.findById(claims.sub);
    if (!user) throw AppError.unauthorized('Unknown user');
    if (user.status !== 'ACTIVE')
      throw new AppError('ACCOUNT_SUSPENDED', 403, 'Account is not active');
    return user;
  }

  listDevices(user: User) {
    return this.repos.devices.listByUser(user.id);
  }
}

export function assertRole(user: User, roles: readonly UserRole[]): void {
  if (!roles.includes(user.role)) throw AppError.forbidden();
}
