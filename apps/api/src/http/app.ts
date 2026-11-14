import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  AppError,
  cancelReservationSchema,
  chatMessagesQuerySchema,
  confirmPaymentSchema,
  createPaymentCardSchema,
  createOrderSchema,
  isAppError,
  marketStatsSchema,
  notificationQuerySchema,
  orderSearchSchema,
  paymentListSchema,
  purchaseSubscriptionSchema,
  rejectPaymentSchema,
  originQuerySchema,
  paginationSchema,
  refreshTokenSchema,
  ratingSchema,
  requestOtpSchema,
  gatewayCallbackSchema,
  sendMessageSchema,
  updateOrderSchema,
  verifyOtpSchema,
  zoneLocateSchema,
  fieldErrors,
} from '@benzin/shared';
import type { Config } from '../config.js';
import type { Clock, User } from '../domain/entities.js';
import type { ChatEventPublisher, Repositories, RouteProvider, SmsSender } from '../ports.js';
import { NOOP_CHAT_EVENTS } from '../ports.js';
import { AuthService } from '../modules/auth-service.js';
import { ChatService } from '../modules/chat-service.js';
import { DistanceService } from '../modules/distance-service.js';
import { LocationService, toZoneView } from '../modules/location-service.js';
import { NotificationService } from '../modules/notification-service.js';
import { OrderService } from '../modules/orders-service.js';
import {
  CardToCardProvider,
  SandboxGatewayProvider,
  ZarinpalGatewayProvider,
} from '../modules/payment-providers.js';
import { PaymentService } from '../modules/payment-service.js';
import { ReputationService } from '../modules/reputation-service.js';
import { ReservationService } from '../modules/reservations-service.js';
import { SettingsService } from '../modules/settings-service.js';
import { StatsService } from '../modules/stats-service.js';
import { attachChatSocket, type ChatSocketHandle } from './chat-socket.js';
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
  /** Realtime chat channel (E5-01); closed together with the HTTP server. */
  chatSocket: ChatSocketHandle;
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
  const notifications = new NotificationService(repos, settings, sms, clock);
  const gateway =
    config.PAYMENT_GATEWAY === 'zarinpal' && config.ZARINPAL_MERCHANT_ID
      ? new ZarinpalGatewayProvider({
          merchantId: config.ZARINPAL_MERCHANT_ID,
          callbackUrl: config.PAYMENT_CALLBACK_URL,
          baseUrl: config.ZARINPAL_BASE_URL,
        })
      : new SandboxGatewayProvider();
  const cardToCard = new CardToCardProvider(repos.paymentCards);
  const payments = new PaymentService(
    repos,
    settings,
    clock,
    { gateway, cardToCard },
    notifications,
  );
  const reputation = new ReputationService(repos, settings, clock, notifications);
  const orders = new OrderService(repos, settings, clock, distance, locations, notifications);
  const reservations = new ReservationService(repos, settings, clock, notifications, reputation);
  // The socket hub is attached to the Fastify server below; the service publishes
  // through this indirection so construction order stays acyclic.
  const events: ChatEventPublisher = { publish: (event) => hub.publisher.publish(event) };
  const hub: { publisher: ChatEventPublisher } = { publisher: NOOP_CHAT_EVENTS };
  const chat = new ChatService(repos, settings, clock, notifications, events);
  const stats = new StatsService(repos, settings, clock);
  const services: AppServices = {
    auth,
    chat,
    notifications,
    orders,
    payments,
    reputation,
    reservations,
    settings,
  };
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

  const chatSocket = attachChatSocket(app, auth, chat);
  hub.publisher = chatSocket.publisher;
  app.addHook('onClose', async () => {
    await chatSocket.close();
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
      maxMessageLength: effective['chat.max_message_length'],
      quickReplies: effective['chat.quick_replies'],
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

  // ---------------------------------------------------------------- chat
  app.get('/v1/chat/conversations', { preHandler: requireAuth }, async (request) => {
    const query = parseInput(paginationSchema, request.query);
    return chat.listMine(currentUser(request), query.limit);
  });

  app.get('/v1/chat/quick-replies', { preHandler: requireAuth }, async () => chat.quickReplies());

  app.get('/v1/orders/:id/conversation', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return chat.openForOrder(currentUser(request), id);
  });

  app.get('/v1/conversations/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return chat.get(currentUser(request), id);
  });

  app.get('/v1/conversations/:id/messages', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const query = parseInput(chatMessagesQuerySchema, request.query);
    return chat.messages(currentUser(request), id, query);
  });

  app.post(
    '/v1/conversations/:id/messages',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = parseInput(sendMessageSchema, request.body);
      const created = await chat.send(currentUser(request), id, body);
      return reply.status(201).send(created);
    },
  );

  app.post('/v1/conversations/:id/contact', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const created = await chat.shareContact(currentUser(request), id);
    return reply.status(201).send(created);
  });

  app.post('/v1/conversations/:id/read', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return chat.markRead(currentUser(request), id);
  });

  // -------------------------------------------------------------- billing
  app.get('/v1/plans', { preHandler: requireAuth }, async () => payments.listPlans());

  app.get('/v1/me/subscription', { preHandler: requireAuth }, async (request) =>
    payments.currentSubscription(currentUser(request)),
  );

  app.post('/v1/subscriptions', { preHandler: requireAuth }, async (request, reply) => {
    const body = parseInput(purchaseSubscriptionSchema, request.body);
    const started = await payments.startPurchase(currentUser(request), body);
    return reply.status(201).send(started);
  });

  app.get('/v1/payments/mine', { preHandler: requireAuth }, async (request) => {
    const query = parseInput(paginationSchema, request.query);
    return payments.listMine(currentUser(request), query.limit);
  });

  app.get('/v1/payments/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return payments.getPayment(currentUser(request), id);
  });

  app.post('/v1/payments/:id/gateway/callback', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    const body = parseInput(gatewayCallbackSchema, request.body ?? {});
    return payments.handleGatewayCallback(currentUser(request), id, body);
  });

  // ---------------------------------------------------------- reputation
  app.get('/v1/me/reputation', { preHandler: requireAuth }, async (request) =>
    reputation.summary(currentUser(request).id),
  );

  app.get('/v1/users/:id/reputation', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return reputation.publicProfile(id);
  });

  app.post('/v1/reservations/:id/rating', { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = parseInput(ratingSchema, request.body);
    const rating = await reputation.rate(currentUser(request), id, body);
    return reply.status(201).send(rating);
  });

  // ------------------------------------------------------- notifications
  app.get('/v1/notifications', { preHandler: requireAuth }, async (request) => {
    const query = parseInput(notificationQuerySchema, request.query);
    return notifications.list(currentUser(request), query);
  });

  app.get('/v1/notifications/unread-count', { preHandler: requireAuth }, async (request) =>
    notifications.unreadCount(currentUser(request)),
  );

  app.post('/v1/notifications/read-all', { preHandler: requireAuth }, async (request) =>
    notifications.markAllRead(currentUser(request)),
  );

  app.post('/v1/notifications/:id/read', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string };
    return notifications.markRead(currentUser(request), id);
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
    '/v1/admin/payments',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async (request) => {
      const query = parseInput(paymentListSchema, request.query);
      return payments.listAllPayments({ status: query.status ?? null, limit: query.limit });
    },
  );

  app.post(
    '/v1/admin/payments/:id/confirm',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = parseInput(confirmPaymentSchema, request.body ?? {});
      return payments.confirmPayment(currentUser(request), id, body.reference ?? null);
    },
  );

  app.post(
    '/v1/admin/payments/:id/reject',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async (request) => {
      const { id } = request.params as { id: string };
      const body = parseInput(rejectPaymentSchema, request.body);
      return payments.rejectPayment(currentUser(request), id, body.reason);
    },
  );

  app.get(
    '/v1/admin/payment-cards',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async () => payments.listPaymentCards(),
  );

  app.post(
    '/v1/admin/payment-cards',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async (request, reply) => {
      const body = parseInput(createPaymentCardSchema, request.body);
      const card = await payments.addPaymentCard(currentUser(request), body);
      return reply.status(201).send(card);
    },
  );

  app.post(
    '/v1/admin/payment-cards/:id/deactivate',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async (request) => {
      const { id } = request.params as { id: string };
      return payments.deactivatePaymentCard(currentUser(request), id);
    },
  );

  app.post(
    '/v1/admin/reconciliation',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async () => payments.reconcile(),
  );

  app.get(
    '/v1/admin/audit',
    { preHandler: [requireAuth, requireRole('ADMIN', 'OWNER')] },
    async (request) => {
      const query = parseInput(paginationSchema, request.query);
      return { items: await repos.audit.list(query.limit) };
    },
  );

  return { app, services, chatSocket };
}
