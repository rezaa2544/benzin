import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError, fieldErrors } from '@benzin/shared';
import type { User } from '../domain/entities.js';
import type { AdminService } from '../modules/admin-service.js';
import type { AuthService } from '../modules/auth-service.js';
import type { ChatService } from '../modules/chat-service.js';
import type { NotificationService } from '../modules/notification-service.js';
import type { PaymentService } from '../modules/payment-service.js';
import type { ProfileService } from '../modules/profile-service.js';
import type { ReputationService } from '../modules/reputation-service.js';
import type { OrderService } from '../modules/orders-service.js';
import type { ReservationService } from '../modules/reservations-service.js';
import type { SettingsService } from '../modules/settings-service.js';
import type { StatsService } from '../modules/stats-service.js';

export interface AppServices {
  auth: AuthService;
  chat: ChatService;
  notifications: NotificationService;
  payments: PaymentService;
  reputation: ReputationService;
  orders: OrderService;
  reservations: ReservationService;
  settings: SettingsService;
  profile: ProfileService;
  admin: AdminService;
  stats: StatsService;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: User;
  }
}

/** Parses untrusted input and converts Zod failures into the shared error envelope. */
export function parseInput<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError('VALIDATION_ERROR', 422, 'Invalid input', fieldErrors(error));
    }
    throw error;
  }
}

export function authenticate(auth: AuthService) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw AppError.unauthorized();
    const token = header.slice('Bearer '.length).trim();
    request.currentUser = await auth.authenticate(token);
  };
}

export function currentUser(request: FastifyRequest): User {
  if (!request.currentUser) throw AppError.unauthorized();
  return request.currentUser;
}
