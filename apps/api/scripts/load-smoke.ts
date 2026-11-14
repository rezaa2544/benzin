/**
 * Light load smoke test (task E1-07).
 *
 * Boots the real Fastify app on an ephemeral port and hits it over HTTP with parallel bursts, so
 * every limit is exercised through the actual request pipeline instead of a direct service call.
 * The repository layer is in-memory: the point is concurrency behaviour, not database throughput.
 *
 *   pnpm --filter @benzin/api load:smoke            # 40 parallel requests per scenario
 *   pnpm --filter @benzin/api load:smoke -- 120     # heavier burst
 *
 * Exit code is non-zero when a limit leaks, which makes it usable as a manual gate on a release.
 */
import { buildApp } from '../src/http/app.js';
import { loadConfig } from '../src/config.js';
import { createMemoryRepositories } from '../src/infra/memory/index.js';
import { applySeed } from '../src/infra/db/seed.js';
import { systemClock } from '../src/domain/entities.js';
import type { SmsSender } from '../src/ports.js';

const burstArg = process.argv.slice(2).find((arg) => /^\d+$/.test(arg));
const burstSize = Number(burstArg ?? 40);

/** Captures OTP messages instead of calling a provider, same trick the tests use. */
class ConsoleSms implements SmsSender {
  readonly messages: { phone: string; message: string }[] = [];

  async send(phone: string, message: string): Promise<void> {
    this.messages.push({ phone, message });
  }

  codeFor(phone: string): string {
    const message = [...this.messages].reverse().find((entry) => entry.phone === phone);
    const match = message?.message.match(/(\d{5,6})/);
    if (!match?.[1]) throw new Error(`No OTP for ${phone}`);
    return match[1];
  }
}

interface CallResult {
  status: number;
  body: unknown;
}

let phoneSeq = 0;
const freshPhone = (): string => `0912${String(1_000_000 + phoneSeq++).padStart(7, '0')}`;

const results: {
  scenario: string;
  requests: number;
  allowed: number;
  blocked: number;
  pass: boolean;
  detail: string;
}[] = [];

async function main(): Promise<void> {
  const sms = new ConsoleSms();
  const repos = createMemoryRepositories();
  const { app } = await buildApp({
    config: loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      OTP_PEPPER: 'load-smoke-pepper',
      JWT_SECRET: 'load-smoke-jwt-secret-value',
      TOKEN_ISSUER: 'benzin',
    }),
    repos,
    sms,
    clock: systemClock,
    routeProvider: null,
  });
  await applySeed(repos);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('No port');
  const base = `http://127.0.0.1:${address.port}`;

  const call = async (path: string, body?: unknown, token?: string): Promise<CallResult> => {
    const response = await fetch(`${base}${path}`, {
      method: path.startsWith('/v1/orders/mine') ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
  };

  const login = async (
    phone: string,
  ): Promise<{ token: string; refreshToken: string; id: string }> => {
    await call('/v1/auth/otp/request', { phone });
    const verified = await call('/v1/auth/otp/verify', { phone, code: sms.codeFor(phone) });
    const session = verified.body as {
      accessToken: string;
      refreshToken: string;
      user: { id: string };
    };
    return { token: session.accessToken, refreshToken: session.refreshToken, id: session.user.id };
  };

  const statuses = (list: CallResult[]): string => {
    const counts = new Map<number, number>();
    for (const entry of list) counts.set(entry.status, (counts.get(entry.status) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([code, count]) => `${code}×${count}`)
      .join(' ');
  };

  const record = (
    scenario: string,
    list: CallResult[],
    ok: number,
    blocked: number,
    note: string,
  ): void => {
    const allowed = list.filter((entry) => entry.status < 400).length;
    const denied = list.length - allowed;
    results.push({
      scenario,
      requests: list.length,
      allowed,
      blocked: denied,
      pass: allowed === ok && denied === blocked,
      detail: note,
    });
  };

  // 1 — OTP resend cooldown: one SMS per burst, the rest are 429.
  {
    const phone = freshPhone();
    const list = await Promise.all(
      Array.from({ length: burstSize }, () => call('/v1/auth/otp/request', { phone })),
    );
    const sent = sms.messages.filter((entry) => entry.phone === phone).length;
    record(
      'otp resend cooldown',
      list,
      1,
      burstSize - 1,
      `sms=${sent} statuses: ${statuses(list)}`,
    );
    if (sent !== 1) results[results.length - 1]!.pass = false;
  }

  // 2 — OTP attempt cap: a parallel guess spray may only spend max_attempts guesses.
  {
    const phone = freshPhone();
    await call('/v1/auth/otp/request', { phone });
    const real = sms.codeFor(phone);
    const wrong = real === '00000' ? '11111' : '00000';
    const list = await Promise.all(
      Array.from({ length: burstSize }, () => call('/v1/auth/otp/verify', { phone, code: wrong })),
    );
    // 401 here means "a guess was spent", not "the limit was bypassed": five are expected.
    const counted = list.filter((entry) => entry.status === 401).length;
    const exceeded = list.filter((entry) => entry.status === 429).length;
    results.push({
      scenario: 'otp attempt cap (5)',
      requests: list.length,
      allowed: counted,
      blocked: exceeded,
      pass: counted <= 5 && counted + exceeded === list.length,
      detail: `guesses spent=${counted} statuses: ${statuses(list)}`,
    });
  }

  // 3 — Open-order cap: a burst from one owner creates at most the free allowance (2).
  {
    const owner = await login(freshPhone());
    const list = await Promise.all(
      Array.from({ length: burstSize }, () => call('/v1/orders', orderBody(), owner.token)),
    );
    record('open orders per user (2)', list, 2, burstSize - 2, `statuses: ${statuses(list)}`);
  }

  // 4 — One order, many takers: exactly one reservation wins.
  {
    const owner = await login(freshPhone());
    const created = await call('/v1/orders', orderBody(), owner.token);
    const orderId = (created.body as { id: string }).id;
    const takerCount = Math.min(burstSize, 50);
    const takers = await Promise.all(Array.from({ length: takerCount }, () => login(freshPhone())));
    const list = await Promise.all(
      takers.map((taker) => call(`/v1/orders/${orderId}/reservations`, undefined, taker.token)),
    );
    record(
      `reservation race, ${takerCount} takers`,
      list,
      1,
      list.length - 1,
      `statuses: ${statuses(list)}`,
    );
  }

  // 5 — Refresh replay: one rotation wins, every replay trips reuse detection.
  {
    const session = await login(freshPhone());
    const replayCount = Math.min(burstSize, 25);
    const list = await Promise.all(
      Array.from({ length: replayCount }, () =>
        call('/v1/auth/refresh', { refreshToken: session.refreshToken }),
      ),
    );
    record(
      `refresh replay, ${replayCount} callers`,
      list,
      1,
      list.length - 1,
      `statuses: ${statuses(list)}`,
    );
  }

  console.info(`\nlight load smoke — ${burstSize} parallel requests per scenario\n`);
  for (const row of results) {
    console.info(
      `${row.pass ? 'PASS' : 'FAIL'}  ${row.scenario.padEnd(28)} requests=${String(row.requests).padStart(3)} allowed=${String(row.allowed).padStart(3)} blocked=${String(row.blocked).padStart(3)}  ${row.detail}`,
    );
  }

  await app.close();
  const failed = results.filter((row) => !row.pass).length;
  console.info(`\n${results.length - failed}/${results.length} scenarios held their limit\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

const orderBody = (): Record<string, unknown> => ({
  side: 'SELL',
  tier: 'T3000',
  litres: 20,
  rateToman: 2600,
  zoneId: '2b1f8f6e-9f1a-4c1b-9d0e-7a1c2b3d4e5f',
  stationName: 'پمپ بنزین میدان آزادی',
  location: { lat: 35.9983, lng: 45.8851 },
});

await main();
