import type { FastifyInstance } from 'fastify';
import type { AppServices } from '../src/http/context.js';
import { buildApp } from '../src/http/app.js';
import { loadConfig } from '../src/config.js';
import { createMemoryRepositories } from '../src/infra/memory/index.js';
import { systemClock, type Clock } from '../src/domain/entities.js';
import { applySeed, BANEH_ZONE } from '../src/infra/db/seed.js';
import type { Repositories, RouteProvider, SmsSender } from '../src/ports.js';
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

/** Deterministic clock for expiry/queue tests: time only moves when the test says so. */
export class ManualClock implements Clock {
  constructor(private current: Date = new Date('2026-01-01T09:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceHours(hours: number): void {
    this.current = new Date(this.current.getTime() + hours * 3_600_000);
  }
}

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
  services: AppServices;
  repos: Repositories;
  sms: CapturingSms;
  clock: Clock;
  close(): Promise<void>;
}

export interface TestContextOptions {
  /** Injected router; omit to exercise the straight-line fallback. */
  routeProvider?: RouteProvider | null;
  /**
   * Wraps the capturing sender the app receives. Lets a test simulate a provider outage while
   * still reading the codes the capturing sender recorded.
   */
  wrapSms?: (inner: CapturingSms) => SmsSender;
}

export async function createTestContext(
  clock: Clock = systemClock,
  options: TestContextOptions = {},
): Promise<TestContext> {
  const repos = createMemoryRepositories();
  const sms = new CapturingSms();
  const sender = options.wrapSms ? options.wrapSms(sms) : sms;
  const built = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      OTP_PEPPER: 'test-pepper-value',
      JWT_SECRET: TEST_JWT_SECRET,
      TOKEN_ISSUER: TEST_ISSUER,
      CORS_ORIGINS: 'http://localhost:5173',
    }),
    repos,
    sms: sender,
    clock,
    routeProvider: options.routeProvider ?? null,
  });
  const app = built.app;
  // Every test context starts from the same seed as development (zones, plans, settings).
  await applySeed(repos);
  await app.ready();
  return { app, services: built.services, repos, sms, clock, close: () => app.close() };
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

/** The seeded zone (Baneh). Tests that need "outside coverage" use a coordinate far away. */
export const ZONE_ID = BANEH_ZONE.id;

let helperPhoneSeq = 0;

/** Fresh unique phone per call: keeps per-user caps (2 open orders) out of the way. */
export const freshPhone = (): string =>
  `0912${String(9_000_000 + helperPhoneSeq++).padStart(7, '0')}`;

export interface TradeSetup {
  owner: { token: string; userId: string; phone: string };
  taker: { token: string; userId: string; phone: string };
  orderId: string;
  reservationId: string;
  /** Thread as seen by the taker right after the reservation request. */
  conversationId: string;
}

/**
 * Drives one trade to the state a chat/notification test needs: order → reservation →
 * (optional) owner acceptance. Every persona is a brand new user.
 */
export async function startTrade(
  ctx: TestContext,
  options: { confirm?: boolean; payload?: Record<string, unknown> } = {},
): Promise<TradeSetup> {
  const ownerPhone = freshPhone();
  const takerPhone = freshPhone();
  const owner = { ...(await login(ctx, ownerPhone)), phone: ownerPhone };
  const taker = { ...(await login(ctx, takerPhone)), phone: takerPhone };

  const order = await ctx.app.inject({
    method: 'POST',
    url: '/v1/orders',
    headers: auth(owner.token),
    payload: orderPayload(options.payload),
  });
  if (order.statusCode !== 201) throw new Error(`order creation failed: ${order.body}`);
  const orderId = (order.json() as { id: string }).id;

  const reservation = await ctx.app.inject({
    method: 'POST',
    url: `/v1/orders/${orderId}/reservations`,
    headers: auth(taker.token),
  });
  if (reservation.statusCode !== 201) throw new Error(`reservation failed: ${reservation.body}`);
  const reservationId = (reservation.json() as { id: string }).id;

  if (options.confirm !== false) {
    const confirmed = await ctx.app.inject({
      method: 'POST',
      url: `/v1/reservations/${reservationId}/confirm`,
      headers: auth(owner.token),
    });
    if (confirmed.statusCode !== 200) throw new Error(`confirm failed: ${confirmed.body}`);
  }

  const conversation = await ctx.app.inject({
    method: 'GET',
    url: `/v1/orders/${orderId}/conversation`,
    headers: auth(owner.token),
  });
  if (conversation.statusCode !== 200) throw new Error(`chat open failed: ${conversation.body}`);
  const conversationId = (conversation.json() as { id: string }).id;

  return { owner, taker, orderId, reservationId, conversationId };
}

export const orderPayload = (overrides: Record<string, unknown> = {}) => ({
  side: 'SELL',
  tier: 'T3000',
  litres: 20,
  rateToman: 2600,
  zoneId: ZONE_ID,
  stationName: 'پمپ بنزین میدان آزادی',
  // Inside the seeded Baneh polygon; Tehran would now be rejected by ZONE_NOT_SUPPORTED.
  location: { lat: 35.9983, lng: 45.8851 },
  ...overrides,
});
