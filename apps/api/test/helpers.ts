import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/http/app.js';
import { loadConfig } from '../src/config.js';
import { createMemoryRepositories } from '../src/infra/memory/index.js';
import { systemClock, type Clock } from '../src/domain/entities.js';
import type { Repositories, SmsSender } from '../src/ports.js';
import type { UserRole } from '@benzin/shared';
import { signAccessToken } from '../src/modules/tokens.js';

export const TEST_JWT_SECRET = 'test-jwt-secret-value-for-tests';
export const TEST_ISSUER = 'benzin';

export const testTokenConfig = {
  secret: TEST_JWT_SECRET,
  issuer: TEST_ISSUER,
  accessTtlSeconds: 900,
} as const;

export const mintAccessToken = (user: { id: string; role: UserRole }): string =>
  signAccessToken({ sub: user.id, role: user.role }, testTokenConfig).token;

export class CapturingSms implements SmsSender {
  readonly messages: { phone: string; message: string }[] = [];

  async send(phone: string, message: string): Promise<void> {
    this.messages.push({ phone, message });
  }

  lastCodeFor(phone: string): string {
    const message = [...this.messages].reverse().find((m) => m.phone === phone);
    if (!message) throw new Error(`No SMS sent to ${phone}`);
    const match = message.message.match(/(\d{5,6})/);
    if (!match?.[1]) throw new Error(`No code in message: ${message.message}`);
    return match[1];
  }
}

export interface TestContext {
  app: FastifyInstance;
  repos: Repositories;
  sms: CapturingSms;
  clock: Clock;
  close(): Promise<void>;
}

export async function createTestContext(clock: Clock = systemClock): Promise<TestContext> {
  const repos = createMemoryRepositories();
  const sms = new CapturingSms();
  const { app } = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      OTP_PEPPER: 'test-pepper-value',
      JWT_SECRET: TEST_JWT_SECRET,
      TOKEN_ISSUER: TEST_ISSUER,
      CORS_ORIGINS: 'http://localhost:5173',
    }),
    repos,
    sms,
    clock,
  });
  await app.ready();
  return { app, repos, sms, clock, close: () => app.close() };
}

/** Registers a user through the real OTP flow and returns their bearer token. */
export async function login(
  ctx: TestContext,
  phone: string,
): Promise<{ token: string; userId: string }> {
  await ctx.app.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone } });
  const code = ctx.sms.lastCodeFor(phone);
  const response = await ctx.app.inject({
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { phone, code },
  });
  const body = response.json() as {
    accessToken: string;
    refreshToken: string;
    user: { id: string };
  };
  return {
    accessToken: body.accessToken,
    // Short alias kept so existing tests read naturally.
    token: body.accessToken,
    refreshToken: body.refreshToken,
    userId: body.user.id,
  };
}

export function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Creates a user with an elevated role and an active session, bypassing OTP. */
export async function loginAsRole(
  ctx: TestContext,
  phone: string,
  role: UserRole,
): Promise<{ token: string; userId: string }> {
  const user = await ctx.repos.users.create({ phone, role });
  return { token: mintAccessToken(user), userId: user.id };
}

export const ZONE_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';

export const orderPayload = (overrides: Record<string, unknown> = {}) => ({
  side: 'SELL',
  tier: 'T3000',
  litres: 20,
  rateToman: 2600,
  zoneId: ZONE_ID,
  stationName: 'پمپ بنزین میدان آزادی',
  location: { lat: 35.6997, lng: 51.338 },
  ...overrides,
});
