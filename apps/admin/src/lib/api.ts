/**
 * Thin JSON client for the admin panel (task E8-01).
 *
 * The panel never talks to `localhost`: requests are relative (`/v1/...`) so the Vite dev
 * server proxies them and production serves the SPA behind the same origin as the API.
 * Every failure is normalised into an `ApiError` carrying the API's stable error code.
 */

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
    requestId?: string;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, status: number, message: string, details: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ApiClientOptions {
  /** Base URL for absolute deployments; empty string keeps requests same-origin. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  getToken?: () => string | null;
  /** Called on 401 so the shell can drop the session and show the login screen. */
  onUnauthorized?: () => void;
}

const buildQuery = (
  query?: Record<string, string | number | boolean | null | undefined>,
): string => {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const serialised = params.toString();
  return serialised ? `?${serialised}` : '';
};

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized?: () => void;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? '';
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.getToken = options.getToken ?? (() => null);
    this.onUnauthorized = options.onUnauthorized;
  }

  async request<T>(
    method: HttpMethod,
    path: string,
    options: {
      body?: unknown;
      query?: Record<string, string | number | boolean | null | undefined>;
    } = {},
  ): Promise<T> {
    const token = this.getToken();
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}${buildQuery(options.query)}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch {
      throw new ApiError('NETWORK', 0, 'Network request failed');
    }

    const text = await response.text();
    const payload: unknown = text.length > 0 ? (JSON.parse(text) as unknown) : null;

    if (!response.ok) {
      const body = (payload ?? {}) as ApiErrorBody;
      const code = body.error?.code ?? `HTTP_${response.status}`;
      if (response.status === 401) this.onUnauthorized?.();
      throw new ApiError(
        code,
        response.status,
        body.error?.message ?? 'Request failed',
        body.error?.details ?? null,
      );
    }
    return payload as T;
  }

  get<T>(path: string, query?: Record<string, string | number | boolean | null | undefined>) {
    return this.request<T>('GET', path, { query });
  }

  post<T>(path: string, body?: unknown) {
    return this.request<T>('POST', path, { body: body ?? {} });
  }

  put<T>(path: string, body?: unknown) {
    return this.request<T>('PUT', path, { body: body ?? {} });
  }

  patch<T>(path: string, body?: unknown) {
    return this.request<T>('PATCH', path, { body: body ?? {} });
  }
}
