import { AppError } from '@benzin/shared';
import type { PaymentCard } from '../domain/entities.js';
import type { PaymentCardRepository, PaymentInitResult, PaymentProvider } from '../ports.js';

/**
 * Card-to-card provider (task E7-04).
 *
 * There is no API to "pay" a card transfer: the payer sends the exact unique amount to
 * the destination card and an operator (or the ingestion job of E7-05, currently blocked
 * on a bank SMS feed) marks the payment as paid. The provider therefore only publishes
 * the destination details; `verify` never approves on its own.
 */
export class CardToCardProvider implements PaymentProvider {
  readonly kind = 'CARD_TO_CARD' as const;

  constructor(private readonly cards: PaymentCardRepository) {}

  private destination(card: PaymentCard): PaymentInitResult['destination'] {
    return {
      cardNumber: card.cardNumber,
      holderName: card.holderName,
      bankName: card.bankName,
    };
  }

  async init(input: {
    paymentId: string;
    amountToman: number;
    uniqueAmountToman: number | null;
    descriptionFa: string;
  }): Promise<PaymentInitResult> {
    const [card] = await this.cards.list(true);
    if (!card) throw new AppError('NO_PAYMENT_CARD', 503, 'No destination card is configured');
    return {
      redirectUrl: null,
      authority: null,
      destination: this.destination(card),
      uniqueAmountToman: input.uniqueAmountToman,
    };
  }

  async verify(): Promise<{ ok: boolean; reference: string | null; reason: string | null }> {
    // Card transfers are settled by an operator (E7-07) or the ingestion job (E7-05).
    return { ok: false, reference: null, reason: 'MANUAL_REVIEW' };
  }
}

/**
 * Sandbox gateway used in development, CI and tests: approving happens locally so the
 * whole purchase flow is exercised without a bank (task E7-02).
 */
export class SandboxGatewayProvider implements PaymentProvider {
  readonly kind = 'GATEWAY' as const;

  constructor(private readonly baseUrl = 'https://sandbox.benzin.local/pay') {}

  async init(input: { paymentId: string }): Promise<PaymentInitResult> {
    return {
      redirectUrl: `${this.baseUrl}/${input.paymentId}`,
      authority: `SBX-${input.paymentId}`,
      destination: null,
      uniqueAmountToman: null,
    };
  }

  async verify(input: {
    paymentId: string;
    authority: string | null;
    reference: string | null;
  }): Promise<{ ok: boolean; reference: string | null; reason: string | null }> {
    if (input.reference === 'FAIL') {
      return { ok: false, reference: null, reason: 'SANDBOX_REJECTED' };
    }
    return { ok: true, reference: input.reference ?? `SBX-${input.paymentId}`, reason: null };
  }
}

interface HttpLike {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<{
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
  }>;
}

/**
 * Zarinpal gateway (task E7-03).
 *
 * Amounts are sent in **Rial** because that is what the provider expects; the platform
 * stores Toman everywhere, so the conversion lives here and nowhere else. Network access
 * is injected so the mapping is unit-tested without touching the bank.
 */
export class ZarinpalGatewayProvider implements PaymentProvider {
  readonly kind = 'GATEWAY' as const;

  constructor(
    private readonly options: {
      merchantId: string;
      callbackUrl: string;
      baseUrl?: string;
      fetchImpl?: HttpLike;
    },
  ) {}

  private get baseUrl(): string {
    return this.options.baseUrl ?? 'https://payment.zarinpal.com';
  }

  private get http(): HttpLike {
    return this.options.fetchImpl ?? (globalThis.fetch as unknown as HttpLike);
  }

  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const response = await this.http(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`zarinpal http ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  }

  async init(input: { paymentId: string; amountToman: number }): Promise<PaymentInitResult> {
    const payload = await this.post('/pg/v4/payment/request.json', {
      merchant_id: this.options.merchantId,
      amount: input.amountToman * 10,
      callback_url: this.options.callbackUrl,
      description: `خرید اشتراک بنزین ${input.paymentId}`,
    });
    const data = (payload.data ?? {}) as { authority?: string; code?: number };
    if (data.code !== 100 || !data.authority) {
      throw new AppError('PAYMENT_VERIFICATION_FAILED', 502, 'Gateway rejected the request', {
        code: data.code ?? null,
      });
    }
    return {
      redirectUrl: `${this.baseUrl}/pg/StartPay/${data.authority}`,
      authority: data.authority,
      destination: null,
      uniqueAmountToman: null,
    };
  }

  async verify(input: {
    paymentId: string;
    amountToman: number;
    authority: string | null;
    reference: string | null;
  }): Promise<{ ok: boolean; reference: string | null; reason: string | null }> {
    if (!input.authority) return { ok: false, reference: null, reason: 'MISSING_AUTHORITY' };
    const payload = await this.post('/pg/v4/payment/verify.json', {
      merchant_id: this.options.merchantId,
      amount: input.amountToman * 10,
      authority: input.authority,
    });
    const data = (payload.data ?? {}) as { code?: number; ref_id?: number };
    if (data.code === 100 || data.code === 101) {
      return { ok: true, reference: String(data.ref_id ?? input.authority), reason: null };
    }
    return { ok: false, reference: null, reason: `GATEWAY_CODE_${data.code ?? 'UNKNOWN'}` };
  }
}
