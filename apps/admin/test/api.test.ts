import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../src/lib/api.js';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('admin API client (E8-01)', () => {
  it('sends the bearer token and parses JSON', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ items: [], total: 0 }));
    const api = new ApiClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      getToken: () => 'tok',
    });
    const result = await api.get<{ total: number }>('/v1/admin/users', { limit: 20 });
    expect(result.total).toBe(0);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/v1/admin/users?limit=20');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('drops empty query values instead of sending them', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const api = new ApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.get('/v1/admin/orders', { status: '', q: undefined, limit: 50, offset: 0 });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('/v1/admin/orders?limit=50&offset=0');
  });

  it('turns the error envelope into a typed ApiError', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: 'DISPUTE_NOT_OPEN',
            message: 'not disputed',
            details: { status: 'OPEN' },
          },
        },
        409,
      ),
    );
    const api = new ApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(api.post('/v1/admin/orders/x/resolve', {})).rejects.toMatchObject({
      code: 'DISPUTE_NOT_OPEN',
      status: 409,
      details: { status: 'OPEN' },
    });
  });

  it('notifies the shell on 401 and never leaks a raw TypeError', async () => {
    const onUnauthorized = vi.fn();
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 'UNAUTHORIZED' } }, 401));
    const api = new ApiClient({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onUnauthorized,
    });
    await expect(api.get('/v1/admin/dashboard')).rejects.toBeInstanceOf(ApiError);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);

    const offline = new ApiClient({
      fetchImpl: (async () => {
        throw new TypeError('failed to fetch');
      }) as unknown as typeof fetch,
    });
    await expect(offline.get('/v1/admin/dashboard')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('serialises the body and sets the JSON content type', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    const api = new ApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await api.patch('/v1/admin/settings', { 'otp.max_attempts': 4 });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ 'otp.max_attempts': 4 }));
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });
});
