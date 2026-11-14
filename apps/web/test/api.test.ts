import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, errorMessage, type ApiDeps } from '../src/lib/api.js';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function deps(overrides: Partial<ApiDeps> = {}): ApiDeps & { calls: Array<[string, RequestInit]> } {
  const calls: Array<[string, RequestInit]> = [];
  const base: ApiDeps = {
    getAccessToken: () => 'access-1',
    getRefreshToken: () => 'refresh-1',
    onTokens: vi.fn(),
    onLogout: vi.fn(),
    ...overrides,
  };
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    calls.push([String(input), init ?? {}]);
    return (base.fetchImpl ?? (() => Promise.resolve(json({}))))(input, init);
  };
  return { ...base, fetchImpl, calls } as ApiDeps & { calls: Array<[string, RequestInit]> };
}

describe('api client (E9-03)', () => {
  it('uses a relative url and sends the bearer token', async () => {
    const base = deps({ fetchImpl: () => Promise.resolve(json({ ok: true })) });
    const result = await new ApiClient(base).get<{ ok: boolean }>('/v1/me');
    expect(result.ok).toBe(true);
    expect(base.calls[0]?.[0]).toBe('/v1/me');
    expect((base.calls[0]?.[1].headers as Record<string, string>)['authorization']).toBe(
      'Bearer access-1',
    );
  });

  it('drops empty query values and keeps the rest', async () => {
    const base = deps({ fetchImpl: () => Promise.resolve(json({ items: [] })) });
    await new ApiClient(base).get('/v1/orders', { zoneId: 'z1', cursor: undefined, limit: 20 });
    expect(base.calls[0]?.[0]).toBe('/v1/orders?zoneId=z1&limit=20');
  });

  it('refreshes once on 401 and retries the original request', async () => {
    let attempt = 0;
    const base = deps({
      fetchImpl: (input) => {
        if (String(input) === '/v1/auth/refresh') {
          return Promise.resolve(json({ accessToken: 'access-2', refreshToken: 'refresh-2' }));
        }
        attempt += 1;
        return attempt === 1
          ? Promise.resolve(json({ error: { code: 'TOKEN_EXPIRED', message: 'expired' } }, 401))
          : Promise.resolve(json({ ok: true }));
      },
    });
    const result = await new ApiClient(base).get<{ ok: boolean }>('/v1/me');
    expect(result.ok).toBe(true);
    expect(base.onTokens).toHaveBeenCalledWith({
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    });
    expect(attempt).toBe(2);
  });

  it('shares a single refresh between concurrent 401s', async () => {
    let refreshes = 0;
    let first = true;
    const base = deps({
      fetchImpl: (input) => {
        if (String(input) === '/v1/auth/refresh') {
          refreshes += 1;
          return Promise.resolve(json({ accessToken: 'a2', refreshToken: 'r2' }));
        }
        const status = first ? 401 : 200;
        first = false;
        return Promise.resolve(
          json(
            status === 401 ? { error: { code: 'TOKEN_EXPIRED', message: 'x' } } : { ok: true },
            status,
          ),
        );
      },
    });
    const api = new ApiClient(base);
    await Promise.all([api.get('/v1/me'), api.get('/v1/orders')]);
    expect(refreshes).toBe(1);
  });

  it('logs out and throws when the refresh fails', async () => {
    const base = deps({
      fetchImpl: () =>
        Promise.resolve(json({ error: { code: 'TOKEN_INVALID', message: 'nope' } }, 401)),
    });
    await expect(new ApiClient(base).get('/v1/me')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    });
    expect(base.onLogout).toHaveBeenCalled();
  });

  it('surfaces the api error envelope', async () => {
    const base = deps({
      fetchImpl: () =>
        Promise.resolve(
          json(
            { error: { code: 'ORDER_LIMIT_REACHED', message: 'too many', details: { max: 2 } } },
            409,
          ),
        ),
    });
    const error = await new ApiClient(base).post('/v1/orders', {}).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'ORDER_LIMIT_REACHED', status: 409, details: { max: 2 } });
  });

  it('turns a network failure into NETWORK', async () => {
    const base = deps({ fetchImpl: () => Promise.reject(new Error('offline')) });
    await expect(new ApiClient(base).get('/v1/me')).rejects.toMatchObject({
      code: 'NETWORK',
      status: 0,
    });
  });

  it('returns undefined for 204 and never parses a body', async () => {
    const base = deps({ fetchImpl: () => Promise.resolve(new Response(null, { status: 204 })) });
    await expect(new ApiClient(base).post('/v1/auth/logout', {})).resolves.toBeUndefined();
  });

  it('maps an error code to a Persian message with a server fallback', () => {
    const map = {
      NETWORK: 'شبکه قطع است',
      ORDER_LIMIT_REACHED: 'سقف سفارش پر است',
      UNKNOWN: 'خطا',
    };
    expect(errorMessage(new ApiError('NETWORK', 'x', 0), map)).toBe('شبکه قطع است');
    expect(errorMessage(new ApiError('ORDER_LIMIT_REACHED', 'x', 409), map)).toBe(
      'سقف سفارش پر است',
    );
    expect(errorMessage(new ApiError('OTHER', 'پیام سرور', 400), map)).toBe('پیام سرور');
    expect(errorMessage(new Error('boom'), map)).toBe('خطا');
  });
});
