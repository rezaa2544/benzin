import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { AppError, fieldErrors } from '@benzin/shared';
import type { User } from '../domain/entities.js';
import type { AuthService } from '../modules/auth-service.js';
import type { OrderService } from '../modules/orders-service.js';
import type { ReservationService } from '../modules/reservations-service.js';
import type { SettingsService } from '../modules/settings-service.js';

export interface AppServices {
  auth: AuthService;
  orders: OrderService;
  reservations: ReservationService;
  settings: SettingsService;
}

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: User;
    sessionToken?: string;
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
    const user = await auth.authenticate(token);
    request.currentUser = user;
    request.sessionToken = token;
  };
}

export function currentUser(request: FastifyRequest): User {
  if (!request.currentUser) throw AppError.unauthorized();
  return request.currentUser;
}
