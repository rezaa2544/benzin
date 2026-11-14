import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError, type UserRole } from '@benzin/shared';

/**
 * Token layer (task E1-04).
 *
 * - Access tokens are short-lived HS256 JWTs: stateless verification on every request.
 * - Refresh tokens are opaque random strings stored **hashed**; each rotation issues a new one
 *   in the same *family*. Presenting an already-rotated token means the token leaked, so the
 *   whole family is revoked (rotation reuse detection).
 */

export interface AccessClaims {
  sub: string;
  role: UserRole;
  iat: number;
  exp: number;
  iss: string;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');
const fromB64url = (input: string): string => Buffer.from(input, 'base64url').toString('utf8');

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface TokenConfig {
  secret: string;
  issuer: string;
  accessTtlSeconds: number;
}

export function signAccessToken(
  payload: { sub: string; role: UserRole },
  config: TokenConfig,
  now: Date = new Date(),
): { token: string; expiresIn: number } {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const claims: AccessClaims = {
    sub: payload.sub,
    role: payload.role,
    iat: issuedAt,
    exp: issuedAt + config.accessTtlSeconds,
    iss: config.issuer,
  };
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const signature = createHmac('sha256', config.secret).update(`${header}.${body}`).digest();
  return { token: `${header}.${body}.${b64url(signature)}`, expiresIn: config.accessTtlSeconds };
}

export function verifyAccessToken(
  token: string,
  config: TokenConfig,
  now: Date = new Date(),
): AccessClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw AppError.unauthorized('Malformed access token');
  const [header, body, signature] = parts as [string, string, string];

  const expected = createHmac('sha256', config.secret).update(`${header}.${body}`).digest();
  const provided = Buffer.from(signature, 'base64url');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw new AppError('TOKEN_INVALID', 401, 'Invalid token signature');
  }

  let claims: AccessClaims;
  try {
    claims = JSON.parse(fromB64url(body)) as AccessClaims;
  } catch {
    throw new AppError('TOKEN_INVALID', 401, 'Invalid token payload');
  }

  if (claims.iss !== config.issuer) throw new AppError('TOKEN_INVALID', 401, 'Invalid issuer');
  if (claims.exp * 1000 <= now.getTime()) throw new AppError('TOKEN_EXPIRED', 401, 'Token expired');
  return claims;
}

export interface IssuedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function createRefreshToken(ttlDays: number, now: Date = new Date()): IssuedRefreshToken {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000),
  };
}
