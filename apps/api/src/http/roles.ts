import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppError, type UserRole } from '@benzin/shared';

/**
 * RBAC decorator equivalent: a `preHandler` factory that runs after `authenticate`.
 * Handlers stay free of role checks (task E1-04).
 */
export function requireRole(...roles: readonly UserRole[]) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const user = request.currentUser;
    if (!user) throw AppError.unauthorized();
    if (!roles.includes(user.role)) {
      throw AppError.forbidden('FORBIDDEN', `Requires one of: ${roles.join(', ')}`);
    }
  };
}
