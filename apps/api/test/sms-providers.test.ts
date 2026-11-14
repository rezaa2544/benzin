import { describe, expect, it } from 'vitest';
import { AppError } from '@benzin/shared';
import {
  ConsoleSmsSender,
  FailoverSmsSender,
  KavenegarTransport,
  SmsIrTransport,
  SmsTransportError,
  createSmsSender,
  formatOtpMessage,
  type FetchLike,
  type SmsAttempt,
} from '../src/infra/sms/index.js';
import { loadConfig } from '../src/config.js';
import { createTestContext, freshPhone } from './helpers.js';
import type { SmsSender } from '../src/ports.js';

/**
 * Task E1-08 — the SMS chain from decision D3: SMS.ir first, Kavenegar as failover.
 *
 * The assertions are about *behaviour under failure*, because that is where a "failover" stops
 * being a word in a document: what the providers receive, what happens when the first one rejects,
 * and what the user sees when both are down.
 */

interface Call {
  url: string;
  init: { method: string; headers: Record<string, string>; body?: string };
}

const fakeFetch = (
  reply: (call: Call) => { ok?: boolean; status?: number; body?: string } | Error,
): { fetchImpl: FetchLike; calls: Call[] } => {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const result = reply(call);
    if (result instanceof Error) throw result;
    return {
      ok: result.ok ?? (result.status ?? 200) < 400,
      status: result.status ?? 200,
      text: async () => result.body ?? '{"status":1}',
    };
  };
  return { fetchImpl, calls };
};

describe('SMS.ir transport', () => {
  it('posts the message to /v1/send/bulk with the API key and a normalised mobile', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({
      body: '{"status":1,"data":{"messageIds":[1]}}',
    }));
    const transport = new SmsIrTransport({
      apiKey: 'smsir-key-123',
      lineNumber: '30007732900000',
      baseUrl: 'https://sms.example',
      fetchImpl,
    });

    await transport.send('09123456789', 'کد ورود شما به بنزین: 12345');

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe('https://sms.example/v1/send/bulk');
    expect(call!.init.method).toBe('POST');
    expect(call!.init.headers['x-api-key']).toBe('smsir-key-123');
    expect(JSON.parse(call!.init.body ?? '{}')).toEqual({
      lineNumber: 30_007_732_900_000,
      messageText: 'کد ورود شما به بنزین: 12345',
      mobiles: ['9123456789'],
    });
  });

  it('treats an HTTP error or a rejected body as a provider failure', async () => {
    const httpError = fakeFetch(() => ({ status: 500, body: 'boom' })).fetchImpl;
    await expect(
      new SmsIrTransport({ apiKey: 'k'.repeat(8), lineNumber: '3000', fetchImpl: httpError }).send(
        '09120000000',
        'x',
      ),
    ).rejects.toBeInstanceOf(SmsTransportError);

    // 200 with status:0 means "the line or template is not usable" — still a failure.
    const rejected = fakeFetch(() => ({
      body: '{"status":0,"message":"line disabled"}',
    })).fetchImpl;
    await expect(
      new SmsIrTransport({ apiKey: 'k'.repeat(8), lineNumber: '3000', fetchImpl: rejected }).send(
        '09120000000',
        'x',
      ),
    ).rejects.toThrow(/rejected by provider/);
  });
});

describe('Kavenegar transport', () => {
  it('calls the keyed send endpoint and accepts status 200', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: '{"return":{"status":200}}' }));
    const transport = new KavenegarTransport({
      apiKey: 'kavenegar-key-1',
      sender: '10004346',
      baseUrl: 'https://kave.example',
      fetchImpl,
    });

    await transport.send('09123456789', 'کد ورود شما به بنزین: 12345');

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v1/kavenegar-key-1/sms/send.json');
    expect(url.searchParams.get('receptor')).toBe('09123456789');
    expect(url.searchParams.get('sender')).toBe('10004346');
    expect(url.searchParams.get('message')).toBe('کد ورود شما به بنزین: 12345');
  });

  it('fails loudly when Kavenegar answers with a non-200 status field', async () => {
    const { fetchImpl } = fakeFetch(() => ({ body: '{"return":{"status":424,"message":"bad"}}' }));
    await expect(
      new KavenegarTransport({
        apiKey: 'kavenegar-key-1',
        sender: '10004346',
        fetchImpl,
      }).send('09120000000', 'x'),
    ).rejects.toThrow(/rejected by provider/);
  });
});

describe('failover chain', () => {
  it('falls through to the second provider and reports both attempts', async () => {
    const attempts: SmsAttempt[] = [];
    const primary = { calls: 0 };
    const secondary = { calls: 0, sent: [] as string[] };

    const sender = new FailoverSmsSender(
      [
        {
          name: 'smsir',
          send: async () => {
            primary.calls += 1;
            throw new SmsTransportError('smsir', 503, 'http 503');
          },
        },
        {
          name: 'kavenegar',
          send: async (_phone, message) => {
            secondary.calls += 1;
            secondary.sent.push(message);
          },
        },
      ],
      (attempt) => attempts.push(attempt),
    );

    await sender.send('09120000000', 'کد 12345');

    expect(primary.calls).toBe(1);
    expect(secondary.sent).toEqual(['کد 12345']);
    expect(attempts.map((a) => [a.provider, a.ok])).toEqual([
      ['smsir', false],
      ['kavenegar', true],
    ]);
  });

  it('throws SMS_UNAVAILABLE (503) with the attempts when every provider is down', async () => {
    const sender = new FailoverSmsSender([
      {
        name: 'smsir',
        send: async () => {
          throw new SmsTransportError('smsir', 500, 'http 500');
        },
      },
      { name: 'kavenegar', send: async () => Promise.reject(new Error('socket hang up')) },
    ]);

    const error = await sender.send('09120000000', 'x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('SMS_UNAVAILABLE');
    expect((error as AppError).httpStatus).toBe(503);
    expect((error as AppError).details).toMatchObject({
      attempts: [
        { provider: 'smsir', ok: false, status: 500 },
        { provider: 'kavenegar', ok: false, status: null, error: 'socket hang up' },
      ],
    });
  });

  it('treats a thrown network error like any other provider failure', async () => {
    const { fetchImpl } = fakeFetch(() => new Error('ETIMEDOUT'));
    const attempts: SmsAttempt[] = [];
    const sender = new FailoverSmsSender(
      [
        new SmsIrTransport({ apiKey: 'k'.repeat(8), lineNumber: '3000', fetchImpl }),
        { name: 'console', send: async () => {} },
      ],
      (attempt) => attempts.push(attempt),
    );

    await sender.send('09120000000', 'x');
    expect(attempts.map((a) => a.ok)).toEqual([false, true]);
  });
});

describe('createSmsSender', () => {
  it('defaults to the console sender so development needs no account', async () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    const lines: string[] = [];
    const sender = createSmsSender(config, { log: (line) => lines.push(line) });

    await sender.send('09120000000', 'کد 12345');

    expect(lines.some((line) => line.includes('[sms] → 09120000000'))).toBe(true);
  });

  it('refuses to boot when a configured provider has no credentials', () => {
    expect(() => createSmsSender(loadConfig({ NODE_ENV: 'test', SMS_PROVIDERS: 'smsir' }))).toThrow(
      /SMS_API_KEY/,
    );
    expect(() =>
      createSmsSender(loadConfig({ NODE_ENV: 'test', SMS_PROVIDERS: 'kavenegar' })),
    ).toThrow(/KAVENEGAR_API_KEY/);
    expect(() => createSmsSender(loadConfig({ NODE_ENV: 'test', SMS_PROVIDERS: 'nexmo' }))).toThrow(
      /Unknown SMS provider/,
    );
  });

  it('keeps the order of SMS_PROVIDERS as the failover order', async () => {
    const calls: string[] = [];
    const config = loadConfig({
      NODE_ENV: 'test',
      SMS_PROVIDERS: 'smsir,kavenegar',
      SMS_API_KEY: 'smsir-key-123',
      SMS_SENDER_LINE: '30007732',
      KAVENEGAR_API_KEY: 'kavenegar-key-1',
      KAVENEGAR_SENDER_LINE: '10004346',
    });
    const fetchImpl: FetchLike = async (url) => {
      calls.push(new URL(url).host);
      const first = calls.length === 1;
      return {
        ok: first ? false : true,
        status: first ? 502 : 200,
        text: async () => (first ? 'down' : '{"return":{"status":200}}'),
      };
    };

    const sender = createSmsSender(config, { fetchImpl, log: () => {} });
    await sender.send('09120000000', 'x');
    expect(calls).toEqual(['api.sms.ir', 'api.kavenegar.com']);
  });
});

describe('OTP request when no provider accepts the message', () => {
  it('answers 503 and lets the user retry immediately instead of serving a cooldown', async () => {
    const sent: number[] = [];
    const outage: SmsSender = {
      send: async () => {
        sent.push(Date.now());
        throw new AppError('SMS_UNAVAILABLE', 503, 'down');
      },
      sendCode: async () => {
        sent.push(Date.now());
        throw new AppError('SMS_UNAVAILABLE', 503, 'down');
      },
    };
    const ctx = await createTestContext(undefined, { wrapSms: () => outage });
    try {
      const phone = freshPhone();
      const first = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/otp/request',
        payload: { phone },
      });
      expect(first.statusCode).toBe(503);
      expect(sent).toHaveLength(1);
      expect((first.json() as { error: { code: string } }).error.code).toBe('SMS_UNAVAILABLE');

      // The same request one second later must not be answered with 429: nothing was delivered,
      // so the code was retired and the cooldown no longer applies.
      const second = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/otp/request',
        payload: { phone },
      });
      expect(second.statusCode).toBe(503);
      // Reached the provider again: the retry was not swallowed by the previous cooldown.
      expect(sent).toHaveLength(2);
      expect((second.json() as { error: { code: string } }).error.code).toBe('SMS_UNAVAILABLE');
    } finally {
      await ctx.close();
    }
  });

  it('still sends a readable code through the console sender', async () => {
    const lines: string[] = [];
    const sender = new ConsoleSmsSender((line) => lines.push(line));
    await sender.send('09120000000', 'کد ورود شما به بنزین: 54321');
    expect(lines[0]).toContain('54321');
  });
});

/**
 * Task E1-09 — a code is not free text. Providers with an approved template deliver it through
 * their verify endpoint (cheaper, and reachable for users who blocked promotional SMS); the chain
 * falls back to text only where a provider has no template.
 */
describe('OTP template channel', () => {
  it('SMS.ir fills the approved template through POST /v1/send/verify', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: '{"status":1,"data":{"messageId":9}}' }));
    const transport = new SmsIrTransport({
      apiKey: 'smsir-key-123',
      lineNumber: '30007732900000',
      templateId: 100_042,
      templateParameter: 'Code',
      baseUrl: 'https://sms.example',
      fetchImpl,
    });

    await transport.sendCode('09123456789', '54321');

    const [call] = calls;
    expect(call!.url).toBe('https://sms.example/v1/send/verify');
    expect(call!.init.method).toBe('POST');
    expect(call!.init.headers['x-api-key']).toBe('smsir-key-123');
    expect(JSON.parse(call!.init.body ?? '{}')).toEqual({
      mobile: '9123456789',
      templateId: 100_042,
      parameters: [{ name: 'Code', value: '54321' }],
    });
  });

  it('SMS.ir refuses to invent a template when none is configured', async () => {
    const transport = new SmsIrTransport({
      apiKey: 'k'.repeat(8),
      lineNumber: '3000',
      fetchImpl: fakeFetch(() => ({ body: '{"status":1}' })).fetchImpl,
    });
    await expect(transport.sendCode('09120000000', '12345')).rejects.toThrow(/no OTP template/);
  });

  it('SMS.ir rejects a 200 response whose body says status:0', async () => {
    const transport = new SmsIrTransport({
      apiKey: 'k'.repeat(8),
      lineNumber: '3000',
      templateId: 42,
      fetchImpl: fakeFetch(() => ({ body: '{"status":0,"message":"template not found"}' }))
        .fetchImpl,
    });
    await expect(transport.sendCode('09120000000', '12345')).rejects.toThrow(
      /rejected by provider/,
    );
  });

  it('Kavenegar sends the code through verify/lookup with token and template', async () => {
    const { fetchImpl, calls } = fakeFetch(() => ({ body: '{"return":{"status":200}}' }));
    const transport = new KavenegarTransport({
      apiKey: 'kavenegar-key-1',
      sender: '10004346',
      template: 'benzin-otp',
      baseUrl: 'https://kave.example',
      fetchImpl,
    });

    await transport.sendCode('09123456789', '54321');

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe('/v1/kavenegar-key-1/verify/lookup.json');
    expect(url.searchParams.get('receptor')).toBe('09123456789');
    expect(url.searchParams.get('token')).toBe('54321');
    expect(url.searchParams.get('template')).toBe('benzin-otp');
    // The free-text message field must not leak into a token lookup.
    expect(url.searchParams.get('message')).toBeNull();
  });

  it('Kavenegar without a template refuses the code path', async () => {
    const transport = new KavenegarTransport({
      apiKey: 'kavenegar-key-1',
      sender: '10004346',
      fetchImpl: fakeFetch(() => ({ body: '{"return":{"status":200}}' })).fetchImpl,
    });
    await expect(transport.sendCode('09120000000', '12345')).rejects.toThrow(/no OTP template/);
  });

  it('mixes modes across the chain: template where configured, free text where not', async () => {
    const attempts: SmsAttempt[] = [];
    const sent: string[] = [];
    const sender = new FailoverSmsSender(
      [
        {
          name: 'smsir',
          send: async () => {},
          sendCode: async () => {
            throw new SmsTransportError('smsir', 500, 'template disabled');
          },
        },
        {
          name: 'kavenegar',
          send: async (_phone, message) => {
            sent.push(message);
          },
        },
      ],
      (attempt) => attempts.push(attempt),
      'کد ورود شما به بنزین: {code}',
    );

    await sender.sendCode('09120000000', '54321');

    expect(sent).toEqual(['کد ورود شما به بنزین: 54321']);
    expect(attempts.map((a) => [a.provider, a.ok, a.mode])).toEqual([
      ['smsir', false, 'template'],
      ['kavenegar', true, 'text'],
    ]);
  });

  it('raises SMS_UNAVAILABLE with the modes attached when no provider takes the code', async () => {
    const sender = new FailoverSmsSender([
      { name: 'smsir', send: async () => {}, sendCode: async () => Promise.reject(new Error('x')) },
      { name: 'kavenegar', send: async () => Promise.reject(new Error('y')) },
    ]);

    const error = await sender.sendCode('09120000000', '1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).details).toMatchObject({
      phone: '09120000000',
      attempts: [
        { provider: 'smsir', mode: 'template', ok: false },
        { provider: 'kavenegar', mode: 'text', ok: false },
      ],
    });
  });

  it('fills the {code} placeholder once, even when the placeholder repeats', () => {
    expect(formatOtpMessage('کد {code} است: {code}', '4321')).toBe('کد 4321 است: 4321');
  });

  it('refuses to boot with an OTP text that has no code placeholder', async () => {
    expect(() =>
      createSmsSender(loadConfig({ NODE_ENV: 'test', SMS_OTP_MESSAGE: 'کد شما آماده است' })),
    ).toThrow(/\{code\}/);
  });

  it('logs which channel delivered the code', async () => {
    const lines: string[] = [];
    const sender = createSmsSender(loadConfig({ NODE_ENV: 'test' }), {
      log: (line) => lines.push(line),
    });
    await sender.sendCode('09120000000', '54321');
    expect(lines.some((line) => line.includes('[sms] delivered via console (text)'))).toBe(true);
  });
});

describe('OTP request through the code path', () => {
  it('hands the generated code to sendCode instead of formatting a message in the service', async () => {
    const ctx = await createTestContext();
    try {
      const phone = freshPhone();
      const response = await ctx.app.inject({
        method: 'POST',
        url: '/v1/auth/otp/request',
        payload: { phone },
      });
      expect(response.statusCode).toBe(202);
      expect(ctx.sms.codes).toHaveLength(1);
      expect(ctx.sms.codes[0]!.phone).toBe(phone);
      expect(ctx.sms.codes[0]!.code).toMatch(/^\d{5}$/);
      // The transcript still shows a readable message, so existing support tooling keeps working.
      expect(ctx.sms.messages.at(-1)?.message).toContain(ctx.sms.codes[0]!.code);
    } finally {
      await ctx.close();
    }
  });
});
