import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  AppError,
  cancelReservationSchema,
  createOrderSchema,
  isAppError,
  marketStatsSchema,
  orderSearchSchema,
  originQuerySchema,
  paginationSchema,
  refreshTokenSchema,
  requestOtpSchema,
  updateOrderSchema,
  verifyOtpSchema,
  zoneLocateSchema,
  fieldErrors,
} from '@benzin/shared';
import type { Config } from '../config.js';
import type { Clock, User } from '../domain/entities.js';
import type { Repositories, RouteProvider, SmsSender } from '../ports.js';
import { AuthService } from '../modules/auth-service.js';
import { DistanceService } from '../modules/distance-service.js';
import { LocationService, toZoneView } from '../modules/location-service.js';
import { OrderService } from '../modules/orders-service.js';
import { ReservationService } from '../modules/reservations-service.js';
import { SettingsService } from '../modules/settings-service.js';
import { StatsService } from '../modules/stats-service.js';
import { authenticate, currentUser, parseInput, type AppServices } from './context.js';
import { requireRole } from './roles.js';

export interface BuildAppOptions {
  config: Config;
  repos: Repositories;
  sms: SmsSender;
  clock: Clock;
  /** Optional real router (OSRM/Mapbox). Absent or failing → straight-line fallback. */
  routeProvider?: RouteProvider | null;
}

export interface BuiltApp {
  app: FastifyInstance;
  services: AppServices;
}

const toPublicUser = (user: User) => ({
  id: user.id,
  phone: user.phone,
  displayName: user.displayName,
  role: user.role,
  createdAt: user.createdAt.toISOString(),
});

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const { config, repos, sms, clock, routeProvider = null } = options;
  const settings = new SettingsService(repos);
  const auth = new AuthService(
    repos,
    settings,
    sms,
    clock,
    {
      secret: config.JWT_SECRET,
      issuer: config.TOKEN_ISSUER,
      accessTtlSeconds: config.ACCESS_TOKEN_TTL_SECONDS,
    },
    config.OTP_PEPPER,
  );
  const locations = new LocationService(repos.zones);
  const distance = new DistanceService(routeProvider);
  const orders = new OrderService(repos, settings, clock, distance, locations);
  const reservations = new ReservationService(repos, settings, clock);
  const stats = new StatsService(repos, settings, clock);
  const services: AppServices = { auth, orders, reservations, settings };
  const requireAuth = authenticate(auth);

  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : { level: config.LOG_LEVEL, redact: ['req.headers.authorization'] },
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.setErrorHandler((rawError: unknown, request, reply) => {
    const error = rawError as { statusCode?: number; message?: string };
    if (isAppError(rawError)) {
      return reply.status(rawError.httpStatus).send({
        error: {
          code: rawError.code,
          message: rawError.message,
          details: rawError.details ?? null,
          requestId: request.id,
        },
      });
    }
    if (rawError instanceof ZodError) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: fieldErrors(rawError),
          requestId: request.id,
        },
      });
    }
    const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
    if (statusCode >= 500) request.log.error({ err: rawError }, 'unhandled error');
    return reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR',
        message:
          statusCode >= 500 ? 'Unexpected server error' : (error.message ?? 'Request failed'),
        details: null,
        requestId: request.id,
      },
    });
  });

  app.get('/healthz', async () => ({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) }));

  app.get('/v1/meta/config', async () => {
    const effective = await settings.get();
    return {
      otpTtlSeconds: effective['otp.ttl_seconds'],
      otpLength: effective['otp.length'],
      reservationTtlMinutes: effective['reservation.ttl_minutes'],
      ownerDecisionTtlMinutes: effective['owner.decision_ttl_minutes'],
      minLitres: effective['order.min_litres'],
      maxLitres: effective['order.max_litres'],
      maxActiveReservations: effective['reservation.max_active_per_user'],
    };
  });

  // ---------------------------------------------------------------- auth
  app.post('/v1/auth/otp/request', async (request, reply) => {
    const body = parseInput(requestOtpSchema, request.body);
    const result = await auth.requestOtp(body.phone);
    return reply.status(202).send({
      expiresAt: result.expiresAt.toISOString(),
      cooldownSeconds: result.cooldownSeconds,
    });
  });

  app.post('/v1/auth/otp/verify', async (request) => {
    const body = parseInput(verifyOtpSchema, request.body);
    const result = await auth.verifyOtp(body.phone, body.code, body.device);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      deviceId: result.deviceId,
      isNewUser: result.isNewUser,
      user: toPublicUser(result.user),
    };
  });

  /** Rotation: the old refresh token dies, the new one inherits the same family. */
  app.post('/v1/auth/refresh', async (request) => {
    const body = parseInput(refreshTokenSchema, request.body);
    const result = await auth.refresh(body.refreshToken);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: toPublicUser(result.user),
    };
  });

  app.post('/v1/auth/logout', async (request, reply) => {
    const body = parseInput(refreshTokenSchema, request.body);
    await auth.logout(body.refreshToken);
    return reply.status(204).send();
  });

  app.post('/v1/auth/logout-all', { preHandler: requireAuth }, async (request, reply) => {
    const revoked = await auth.logoutAll(currentUser(request));
    return reply.status(200).send({ revoked });
  });

  app.get('/v1/me/devices', { preHandler: requireAuth }, async (request) => {
    const devices = await auth.listDevices(currentUser(request));
    return {
      items: devices.map((device) => ({
        id: device.id,
        platform: device.platform,
        deviceId: device.deviceId,
        appVersion: device.appVersion,
        lastSeenAt: device.lastSeenAt.toISOString(),
      })),
    };
  });

  app.get('/v1/me', { preHandler: requireAuth }, async (request) =>
    toPublicUser(currentUser(request)),
  );

  // --------------------------------------------------------------- zones
  app.get('/v1/zones', { preHandler: requireAuth }, async () => {
    const zones = await repos.zones.listActive();
    return { items: zones.map(toZoneView) };
  });

  app.get('/v1/zones/locate', { preHandler: requireAuth }, async (request) => {
    const query = parseInput(zoneLocateSchema, request.query);
    return locations.locate({ lat: query.lat, lng: query.lng });
  });

  // -------------------------------------------------------------- orders
  app.get('/v1/orders', { preHandler: requireAuth }, async (request) => {
    const query = parseInput(orderSearchSchema, request.query);
    return orders.search(query);
  });

  app.post('/v1/orders', { preHandler: requireAuth }, async (request, reply) => {
    const body = parseInput(createOrderSchema, request.body);
    const created = await orders.create(currentUser(request), body);
    return reply.status(201).send(created);
  });

  app.get('/v1/orders/mine', { preHandler: requireAuth }, async (request) => {
    const query = parseInput(paginationSchema, request.query);
    return { items: await orders.listMine(currentUser(request), query.limit) };
  });

  app.get('/v1/orders/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const origin = parseInput(originQuerySchema, request.query);
    return orders.getById(
      id,
      origin.lat !== undefined && origin.lng !== undefined
        ? { lat: origin.lat, lng: origin.lng }
        : null,
    );
  });

  app.patch('/v1/orders/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const body = parseInput(updateOrderSchema, request.body);
    return orders.update(currentUser(request), id, body);
  });

  app.post('/v1/orders/:id/cancel', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return orders.cancel(currentUser(request), id);
  });

  // ---------------------------------------------------------------- stats
  app.get('/v1/stats/market', { preHandler: requireAuth }, async (request) => {
    const query = parseInput(marketStatsSchema, request.query);
    return stats.market(query);
  });

  // -------------------------------------------------------- reservations
  app.post('/v1/orders/:id/reservations', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const created = await reservations.request(currentUser(request), id);
    return reply.status(201).send(created);
  });

  app.get('/v1/reservations/mine', { preHandler: requireAuth }, async (request) => {
    const query = parseInput(paginationSchema, request.query);
    return { items: await reservations.listMine(currentUser(request), query.limit) };
  });

  app.get('/v1/reservations/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return reservations.get(currentUser(request), id);
  });

  app.post('/v1/reservations/:id/confirm', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return reservations.confirm(currentUser(request), id);
  });

  app.post('/v1/reservations/:id/reject', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return reservations.reject(currentUser(request), id);
  });

  app.post('/v1/reservations/:id/complete', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return reservations.complete(currentUser(request), id);
  });

  app.get('/v1/reservations/:id/contact', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return reservations.revealContact(currentUser(request), id);
  });

  app.post('/v1/reservations/:id/dispute', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { reason?: unknown };
    const reason =
      typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    return reservations.dispute(currentUser(request), id, reason);
  });

  app.post('/v1/reservations/:id/cancel', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const body = parseInput(cancelReservationSchema, request.body ?? {});
    return reservations.cancel(currentUser(request), id, body.reason);
  });

  // ------------------------------------------------------------- admin
  app.get(
    '/v1/admin/settings',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async () => {
      return { settings: await settings.get() };
    },
  );

  app.patch(
    '/v1/admin/settings',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async (request) => {
      const user = currentUser(request);
      const patch = request.body as Record<string, unknown> | undefined;
      if (!patch || typeof patch !== 'object') throw AppError.validation('Body must be an object');
      return { updated: await settings.update(user.id, patch) };
    },
  );

  app.get(
    '/v1/admin/audit',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async (request) => {
      const query = parseInput(paginationSchema, request.query);
      return { items: await repos.audit.list(query.limit) };
    },
  );

  return { app, services };
}
