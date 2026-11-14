import { AppError } from '@benzin/shared';
import type { SmsSender } from '../../ports.js';

/**
 * SMS delivery layer (decisions D3 / spike E0-04).
 *
 * The domain only knows `SmsSender`. This module turns that single port into a *chain*: the first
 * provider that accepts the message wins, and every attempt is reported so a failover is visible in
 * the logs instead of being a line in a document (task E1-08).
 *
 * Providers are chosen by `SMS_PROVIDERS` (comma separated, order = priority). Without keys the
 * chain is the console sender, which keeps development and CI offline.
 */

/** Minimal fetch shape so tests can inject a fake without touching the network. */
export interface FetchLike {
  (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ): Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
}

export interface SmsAttempt {
  provider: string;
  ok: boolean;
  status: number | null;
  error: string | null;
}

export interface SmsTransport {
  readonly name: string;
  send(phone: string, message: string): Promise<void>;
}

/** A single provider said no; the chain decides whether that is fatal. */
export class SmsTransportError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'SmsTransportError';
  }
}

export type AttemptLogger = (attempt: SmsAttempt) => void;

/** Development sender: the message lands in the log so OTP works without an account. */
export class ConsoleSmsSender implements SmsSender {
  readonly name = 'console' as const;
  readonly attempts: SmsAttempt[] = [];

  constructor(private readonly logger: (message: string) => void = (m) => console.info(m)) {}

  async send(phone: string, message: string): Promise<void> {
    this.logger(`[sms] → ${phone}: ${message}`);
  }
}

/**
 * Walks the chain until a provider accepts the message. Throws `SMS_UNAVAILABLE` (503) only when
 * every provider failed, with the attempts attached so the caller can explain what happened.
 */
export class FailoverSmsSender implements SmsSender {
  constructor(
    private readonly transports: SmsTransport[],
    private readonly onAttempt: AttemptLogger = () => {},
  ) {}

  async send(phone: string, message: string): Promise<void> {
    const attempts: SmsAttempt[] = [];

    for (const transport of this.transports) {
      try {
        await transport.send(phone, message);
        const success: SmsAttempt = {
          provider: transport.name,
          ok: true,
          status: null,
          error: null,
        };
        attempts.push(success);
        this.onAttempt(success);
        return;
      } catch (error) {
        const failure: SmsAttempt = {
          provider: transport.name,
          ok: false,
          status: error instanceof SmsTransportError ? error.status : null,
          error: error instanceof Error ? error.message : String(error),
        };
        attempts.push(failure);
        this.onAttempt(failure);
      }
    }

    throw new AppError('SMS_UNAVAILABLE', 503, 'No SMS provider accepted the message', {
      attempts,
    });
  }
}

/** SMS.ir bulk endpoint; mobile numbers are sent without the leading zero. */
export class SmsIrTransport implements SmsTransport {
  readonly name = 'smsir' as const;

  constructor(
    private readonly options: {
      apiKey: string;
      lineNumber: string;
      baseUrl?: string;
      fetchImpl?: FetchLike;
      timeoutMs?: number;
    },
  ) {}

  private get http(): FetchLike {
    return this.options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async send(phone: string, message: string): Promise<void> {
    const base = this.options.baseUrl ?? 'https://api.sms.ir';
    const line = /^\d+$/.test(this.options.lineNumber)
      ? Number(this.options.lineNumber)
      : this.options.lineNumber;
    const response = await this.http(`${base}/v1/send/bulk`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': this.options.apiKey,
      },
      body: JSON.stringify({
        lineNumber: line,
        messageText: message,
        mobiles: [phone.replace(/^0+/, '')],
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
    });
    const body = await response.text();
    if (!response.ok)
      throw new SmsTransportError(this.name, response.status, `http ${response.status}`);
    // SMS.ir answers 200 with `{"status":1}` on success and `{"status":0,...}` on a rejected line.
    if (!/"status"\s*:\s*1(?!\d)/.test(body)) {
      throw new SmsTransportError(this.name, response.status, 'rejected by provider');
    }
  }
}

/** Kavenegar send endpoint; the API key is part of the path, the message travels in the query. */
export class KavenegarTransport implements SmsTransport {
  readonly name = 'kavenegar' as const;

  constructor(
    private readonly options: {
      apiKey: string;
      sender: string;
      baseUrl?: string;
      fetchImpl?: FetchLike;
      timeoutMs?: number;
    },
  ) {}

  private get http(): FetchLike {
    return this.options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  async send(phone: string, message: string): Promise<void> {
    const base = this.options.baseUrl ?? 'https://api.kavenegar.com';
    const query = new URLSearchParams({
      receptor: phone,
      sender: this.options.sender,
      message,
    });
    const response = await this.http(
      `${base}/v1/${encodeURIComponent(this.options.apiKey)}/sms/send.json?${query.toString()}`,
      {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
      },
    );
    const body = await response.text();
    if (!response.ok)
      throw new SmsTransportError(this.name, response.status, `http ${response.status}`);
    // Kavenegar wraps everything in `{"return":{"status":200,...}}`.
    if (!/"status"\s*:\s*200(?!\d)/.test(body)) {
      throw new SmsTransportError(this.name, response.status, 'rejected by provider');
    }
  }
}

export interface SmsConfig {
  SMS_PROVIDERS: string[];
  SMS_API_KEY?: string;
  SMS_SENDER_LINE?: string;
  SMS_IR_BASE_URL?: string;
  KAVENEGAR_API_KEY?: string;
  KAVENEGAR_SENDER_LINE?: string;
  KAVENEGAR_BASE_URL?: string;
  SMS_TIMEOUT_MS?: number;
}

const buildTransport = (
  name: string,
  config: SmsConfig,
  deps: { fetchImpl?: FetchLike; log: (message: string) => void },
): SmsTransport => {
  if (name === 'console') {
    const sender = new ConsoleSmsSender(deps.log);
    return { name: 'console', send: (phone, message) => sender.send(phone, message) };
  }
  if (name === 'smsir') {
    if (!config.SMS_API_KEY || !config.SMS_SENDER_LINE) {
      throw new Error('SMS_PROVIDERS includes smsir but SMS_API_KEY / SMS_SENDER_LINE are missing');
    }
    return new SmsIrTransport({
      apiKey: config.SMS_API_KEY,
      lineNumber: config.SMS_SENDER_LINE,
      ...(config.SMS_IR_BASE_URL ? { baseUrl: config.SMS_IR_BASE_URL } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(config.SMS_TIMEOUT_MS ? { timeoutMs: config.SMS_TIMEOUT_MS } : {}),
    });
  }
  if (name === 'kavenegar') {
    if (!config.KAVENEGAR_API_KEY || !config.KAVENEGAR_SENDER_LINE) {
      throw new Error(
        'SMS_PROVIDERS includes kavenegar but KAVENEGAR_API_KEY / KAVENEGAR_SENDER_LINE are missing',
      );
    }
    return new KavenegarTransport({
      apiKey: config.KAVENEGAR_API_KEY,
      sender: config.KAVENEGAR_SENDER_LINE,
      ...(config.KAVENEGAR_BASE_URL ? { baseUrl: config.KAVENEGAR_BASE_URL } : {}),
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      ...(config.SMS_TIMEOUT_MS ? { timeoutMs: config.SMS_TIMEOUT_MS } : {}),
    });
  }
  throw new Error(`Unknown SMS provider "${name}" in SMS_PROVIDERS`);
};

/**
 * Builds the sender chain from configuration. Failures are logged one line each so an operator can
 * see *which* provider went down; the domain never learns a provider name.
 */
export const createSmsSender = (
  config: SmsConfig,
  deps: { fetchImpl?: FetchLike; log?: (message: string) => void } = {},
): SmsSender => {
  const log = deps.log ?? ((message: string) => console.info(message));
  const names = config.SMS_PROVIDERS.map((name) => name.trim()).filter(Boolean);
  if (names.length === 0) throw new Error('SMS_PROVIDERS must list at least one provider');

  const transports = names.map((name) => buildTransport(name, config, { ...deps, log }));
  return new FailoverSmsSender(transports, (attempt) => {
    if (attempt.ok) {
      log(`[sms] delivered via ${attempt.provider}`);
      return;
    }
    log(`[sms] ${attempt.provider} failed: ${attempt.error ?? 'unknown error'}`);
  });
};
