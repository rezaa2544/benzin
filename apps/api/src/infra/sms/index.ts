import { AppError } from '@benzin/shared';
import type { SmsSender } from '../../ports.js';

/**
 * SMS delivery layer (decisions D3 / spike E0-04, tasks E1-08 and E1-09).
 *
 * The domain only knows `SmsSender`. This module turns that single port into a *chain*: the first
 * provider that accepts the message wins, and every attempt is reported so a failover is visible in
 * the logs instead of being a line in a document.
 *
 * A code travels on the cheapest channel each provider offers: an approved OTP template when one is
 * configured (`verify` / `lookup` endpoints, which also reach numbers that block promotional SMS),
 * otherwise the configured free text. The chain may therefore mix modes — that is the point, the
 * fallback must not depend on the first provider's configuration.
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

/** `template` = provider-side approved template, `text` = free-form message. */
export type SmsAttemptMode = 'template' | 'text';

export interface SmsAttempt {
  provider: string;
  ok: boolean;
  status: number | null;
  error: string | null;
  mode: SmsAttemptMode;
}

export interface SmsTransport {
  readonly name: string;
  /** Free text. */
  send(phone: string, message: string): Promise<void>;
  /** One-time code through the provider's template, when the provider has one configured. */
  sendCode?(phone: string, code: string): Promise<void>;
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

/** Persian OTP text, used only when no provider has a template (assumption A36). */
export const DEFAULT_OTP_MESSAGE = 'کد ورود شما به بنزین: {code}';

/** Fills the `{code}` placeholder; the placeholder is enforced at boot, never silently dropped. */
export const formatOtpMessage = (template: string, code: string): string =>
  template.replaceAll('{code}', code);

/** SMS.ir expects `9123456789`; Kavenegar accepts either but the same normal form is safer. */
const normalizeMobile = (phone: string): string => phone.replace(/^0+/, '');

/**
 * Development sender: the message lands in the log so OTP works without an account. Codes take the
 * template-free path on purpose — the console has no approved template.
 */
export class ConsoleSmsSender implements SmsSender {
  readonly name = 'console' as const;
  readonly attempts: SmsAttempt[] = [];

  constructor(
    private readonly logger: (message: string) => void = (m) => console.info(m),
    private readonly otpMessage: string = DEFAULT_OTP_MESSAGE,
  ) {}

  async send(phone: string, message: string): Promise<void> {
    this.logger(`[sms] → ${phone}: ${message}`);
  }

  async sendCode(phone: string, code: string): Promise<void> {
    await this.send(phone, formatOtpMessage(this.otpMessage, code));
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
    private readonly otpMessage: string = DEFAULT_OTP_MESSAGE,
  ) {}

  async send(phone: string, message: string): Promise<void> {
    await this.deliver(phone, (transport) => ({
      mode: 'text',
      run: () => transport.send(phone, message),
    }));
  }

  async sendCode(phone: string, code: string): Promise<void> {
    await this.deliver(phone, (transport) =>
      transport.sendCode
        ? { mode: 'template', run: () => transport.sendCode!(phone, code) }
        : {
            mode: 'text',
            run: () => transport.send(phone, formatOtpMessage(this.otpMessage, code)),
          },
    );
  }

  private async deliver(
    phone: string,
    plan: (transport: SmsTransport) => { mode: SmsAttemptMode; run: () => Promise<void> },
  ): Promise<void> {
    const attempts: SmsAttempt[] = [];

    for (const transport of this.transports) {
      const attempt = plan(transport);
      try {
        await attempt.run();
        const success: SmsAttempt = {
          provider: transport.name,
          ok: true,
          status: null,
          error: null,
          mode: attempt.mode,
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
          mode: attempt.mode,
        };
        attempts.push(failure);
        this.onAttempt(failure);
      }
    }

    throw new AppError('SMS_UNAVAILABLE', 503, 'No SMS provider accepted the message', {
      phone,
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
      /** Approved OTP template id; without it the transport falls back to free text. */
      templateId?: number;
      /** Name of the template parameter that carries the code (SMS.ir calls it `code` by default). */
      templateParameter?: string;
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
        mobiles: [normalizeMobile(phone)],
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
    });
    await this.expectAccepted(response);
  }

  /** `POST /v1/send/verify` — the code is filled into an approved template on a service line. */
  async sendCode(phone: string, code: string): Promise<void> {
    if (!this.options.templateId) {
      throw new SmsTransportError(this.name, null, 'no OTP template configured');
    }
    const base = this.options.baseUrl ?? 'https://api.sms.ir';
    const response = await this.http(`${base}/v1/send/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': this.options.apiKey,
      },
      body: JSON.stringify({
        mobile: normalizeMobile(phone),
        templateId: this.options.templateId,
        parameters: [{ name: this.options.templateParameter ?? 'code', value: code }],
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
    });
    await this.expectAccepted(response);
  }

  private async expectAccepted(response: {
    ok: boolean;
    status: number;
    text: () => Promise<string>;
  }): Promise<void> {
    const body = await response.text();
    if (!response.ok)
      throw new SmsTransportError(this.name, response.status, `http ${response.status}`);
    // SMS.ir answers 200 with `{"status":1}` on success and `{"status":0,...}` on a rejected line,
    // template or balance. The HTTP code alone is not a success signal.
    if (!/"status"\s*:\s*1(?!\d)/.test(body)) {
      throw new SmsTransportError(this.name, response.status, 'rejected by provider');
    }
  }
}

/** Kavenegar send/lookup endpoints; the API key is part of the path, the payload in the query. */
export class KavenegarTransport implements SmsTransport {
  readonly name = 'kavenegar' as const;

  constructor(
    private readonly options: {
      apiKey: string;
      sender: string;
      /** Approved template name for `verify/lookup`; without it codes travel as free text. */
      template?: string;
      baseUrl?: string;
      fetchImpl?: FetchLike;
      timeoutMs?: number;
    },
  ) {}

  private get http(): FetchLike {
    return this.options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private get base(): string {
    return this.options.baseUrl ?? 'https://api.kavenegar.com';
  }

  private get keyedPath(): string {
    return `/v1/${encodeURIComponent(this.options.apiKey)}`;
  }

  async send(phone: string, message: string): Promise<void> {
    const query = new URLSearchParams({
      receptor: phone,
      sender: this.options.sender,
      message,
    });
    const response = await this.http(`${this.base}${this.keyedPath}/sms/send.json?${query}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
    });
    await this.expectAccepted(response);
  }

  /** `GET /v1/{key}/verify/lookup.json?receptor&token&template` — token is the code. */
  async sendCode(phone: string, code: string): Promise<void> {
    if (!this.options.template) {
      throw new SmsTransportError(this.name, null, 'no OTP template configured');
    }
    const query = new URLSearchParams({
      receptor: phone,
      token: code,
      template: this.options.template,
    });
    const response = await this.http(`${this.base}${this.keyedPath}/verify/lookup.json?${query}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
    });
    await this.expectAccepted(response);
  }

  private async expectAccepted(response: {
    ok: boolean;
    status: number;
    text: () => Promise<string>;
  }): Promise<void> {
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
  SMS_IR_TEMPLATE_ID?: number;
  SMS_IR_TEMPLATE_PARAMETER?: string;
  KAVENEGAR_API_KEY?: string;
  KAVENEGAR_SENDER_LINE?: string;
  KAVENEGAR_BASE_URL?: string;
  KAVENEGAR_TEMPLATE?: string;
  SMS_OTP_MESSAGE?: string;
  SMS_TIMEOUT_MS?: number;
}

const buildTransport = (
  name: string,
  config: SmsConfig,
  deps: { fetchImpl?: FetchLike; log: (message: string) => void },
): SmsTransport => {
  if (name === 'console') {
    const sender = new ConsoleSmsSender(deps.log);
    // No `sendCode`: the console has no approved template, so codes take the honest text path and
    // the log line says `(text)` instead of pretending a template was used.
    return { name: 'console', send: (phone, message) => sender.send(phone, message) };
  }
  if (name === 'smsir') {
    if (!config.SMS_API_KEY || !config.SMS_SENDER_LINE) {
      throw new Error('SMS_PROVIDERS includes smsir but SMS_API_KEY / SMS_SENDER_LINE are missing');
    }
    return new SmsIrTransport({
      apiKey: config.SMS_API_KEY,
      lineNumber: config.SMS_SENDER_LINE,
      ...(config.SMS_IR_TEMPLATE_ID ? { templateId: config.SMS_IR_TEMPLATE_ID } : {}),
      ...(config.SMS_IR_TEMPLATE_PARAMETER
        ? { templateParameter: config.SMS_IR_TEMPLATE_PARAMETER }
        : {}),
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
      ...(config.KAVENEGAR_TEMPLATE ? { template: config.KAVENEGAR_TEMPLATE } : {}),
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

  const otpMessage = config.SMS_OTP_MESSAGE ?? DEFAULT_OTP_MESSAGE;
  // A text template without the placeholder would deliver a code-less message: refuse to boot.
  if (!otpMessage.includes('{code}')) {
    throw new Error('SMS_OTP_MESSAGE must contain the {code} placeholder');
  }

  const transports = names.map((name) => buildTransport(name, config, { ...deps, log }));
  return new FailoverSmsSender(
    transports,
    (attempt) => {
      const mode = `(${attempt.mode})`;
      if (attempt.ok) {
        log(`[sms] delivered via ${attempt.provider} ${mode}`);
        return;
      }
      log(`[sms] ${attempt.provider} failed ${mode}: ${attempt.error ?? 'unknown error'}`);
    },
    otpMessage,
  );
};
