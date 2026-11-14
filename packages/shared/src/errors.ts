/** Stable, user-facing error codes. Clients map them to Persian copy; never parse messages. */
export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'REFRESH_TOKEN_INVALID',
  'REFRESH_TOKEN_REUSED',
  'FORBIDDEN',
  'NOT_FOUND',
  'RATE_LIMITED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_ATTEMPTS_EXCEEDED',
  'PHONE_LOCKED',
  'ACCOUNT_SUSPENDED',
  'SUBSCRIPTION_REQUIRED',
  'ZONE_NOT_SUPPORTED',
  'ZONE_MISMATCH',
  'OUTSIDE_ZONE',
  'ORDER_NOT_AVAILABLE',
  'ORDER_LIMIT_REACHED',
  'RESERVATION_LIMIT_REACHED',
  'RESERVATION_NOT_FOUND',
  'RESERVATION_NOT_ACTIVE',
  'TRADE_CYCLE_BLOCKED',
  'NOT_ORDER_OWNER',
  'NOT_RESERVATION_PARTY',
  'CONVERSATION_NOT_FOUND',
  'CONVERSATION_CLOSED',
  'NOT_CONVERSATION_PARTY',
  'CONTACT_SHARING_BLOCKED',
  'MESSAGE_TOO_LONG',
  'NOTIFICATION_NOT_FOUND',
  'INVALID_STATE_TRANSITION',
  'ALREADY_DECIDED',
  'CONFLICT',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, httpStatus: number, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }

  static notFound(code: ErrorCode = 'NOT_FOUND', message = 'Resource not found'): AppError {
    return new AppError(code, 404, message);
  }

  static forbidden(code: ErrorCode = 'FORBIDDEN', message = 'Not allowed'): AppError {
    return new AppError(code, 403, message);
  }

  static conflict(code: ErrorCode = 'CONFLICT', message = 'Conflicting state'): AppError {
    return new AppError(code, 409, message);
  }

  static validation(message = 'Invalid input', details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', 422, message, details);
  }

  static unauthorized(message = 'Authentication required'): AppError {
    return new AppError('UNAUTHORIZED', 401, message);
  }
}

export const isAppError = (error: unknown): error is AppError => error instanceof AppError;
