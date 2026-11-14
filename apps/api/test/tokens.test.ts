import { describe, expect, it } from 'vitest';
import { AppError } from '@benzin/shared';
import {
  createRefreshToken,
  sha256,
  signAccessToken,
  verifyAccessToken,
} from '../src/modules/tokens.js';
import { TEST_ISSUER, TEST_JWT_SECRET } from './helpers.js';

const config = { secret: TEST_JWT_SECRET, issuer: TEST_ISSUER, accessTtlSeconds: 900 };

describe('access tokens', () => {
  it('signs and verifies an HS256 token', () => {
    const { token, expiresIn } = signAccessToken({ sub: 'user-1', role: 'USER' }, config);
    expect(expiresIn).toBe(900);
    const claims = verifyAccessToken(token, config);
    expect(claims.sub).toBe('user-1');
    expect(claims.role).toBe('USER');
    expect(claims.iss).toBe(TEST_ISSUER);
  });

  it('rejects a tampered payload', () => {
    const { token } = signAccessToken({ sub: 'user-1', role: 'USER' }, config);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ sub: 'user-1', role: 'ADMIN', iat: 0, exp: 9999999999, iss: TEST_ISSUER }),
    ).toString('base64url');
    expect(() => verifyAccessToken(`${header}.${forged}.${signature}`, config)).toThrow(AppError);
  });

  it('rejects a token signed with another secret', () => {
    const { token } = signAccessToken(
      { sub: 'user-1', role: 'USER' },
      { ...config, secret: 'x'.repeat(32) },
    );
    expect(() => verifyAccessToken(token, config)).toThrow(/signature/i);
  });

  it('rejects an expired token with TOKEN_EXPIRED', () => {
    const past = new Date(Date.now() - 3600_000);
    const { token } = signAccessToken({ sub: 'user-1', role: 'USER' }, config, past);
    try {
      verifyAccessToken(token, config);
      expect.unreachable();
    } catch (error) {
      expect((error as AppError).code).toBe('TOKEN_EXPIRED');
    }
  });

  it('rejects a foreign issuer', () => {
    const { token } = signAccessToken(
      { sub: 'user-1', role: 'USER' },
      { ...config, issuer: 'payesh' },
    );
    expect(() => verifyAccessToken(token, config)).toThrow(/issuer/i);
  });

  it('rejects a malformed token', () => {
    expect(() => verifyAccessToken('not-a-jwt', config)).toThrow(AppError);
  });
});

describe('refresh tokens', () => {
  it('stores only the hash of a high-entropy value', () => {
    const issued = createRefreshToken(30);
    expect(issued.token.length).toBeGreaterThanOrEqual(40);
    expect(issued.tokenHash).toBe(sha256(issued.token));
    expect(issued.tokenHash).not.toContain(issued.token);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
  });

  it('never repeats a token', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => createRefreshToken(1).token));
    expect(tokens.size).toBe(200);
  });
});
