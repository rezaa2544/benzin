import { useEffect, useState } from 'react';
import { toPersianDigits, toAsciiDigits } from '@benzin/shared';
import { errorMessage } from '../lib/api.js';
import type { ApiClient } from '../lib/api.js';
import type { AuthResult, MetaConfig, OtpRequestResult } from '../lib/types.js';
import { t, tf } from '../lib/i18n.js';
import { Notice } from './parts.js';
import { FormField, OtpInput } from '../components/index.js';

export interface LoginPageProps {
  api: ApiClient;
  config: MetaConfig | null;
  onAuthenticated: (auth: AuthResult) => void;
  /** Shown when the user was bounced here by an expired session. */
  reason?: string;
}

const PHONE = /^09\d{9}$/;

/**
 * Two-step OTP login (E9-04): phone → code. The cooldown from the server drives the resend
 * timer, the code boxes accept Persian digits, and the phone is normalised before it is
 * ever sent (no spaces, no `+98`).
 */
export function LoginPage({ api, config, onAuthenticated, reason }: LoginPageProps): JSX.Element {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(reason ?? null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const length = config?.otpLength ?? 5;
  const errors = (error: unknown): void => setError(errorMessage(error, errorMap));

  const normalised = (input: string): string => {
    const digits = toAsciiDigits(input).replace(/[^\d+]/g, '');
    if (digits.startsWith('+98')) return `0${digits.slice(3)}`;
    if (digits.startsWith('0098')) return `0${digits.slice(4)}`;
    if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
    return digits;
  };

  const requestCode = async (): Promise<void> => {
    setError(null);
    const value = normalised(phone);
    if (!PHONE.test(value)) {
      setError(t('form.errorRequired'));
      return;
    }
    setBusy(true);
    try {
      const result = await api.post<OtpRequestResult>('/v1/auth/otp/request', { phone: value });
      setCooldown(result.cooldownSeconds ?? 60);
      setPhone(value);
      setStep('code');
      setInfo(tf('login.sent', { phone: toPersianDigits(value) }));
    } catch (cause) {
      errors(cause);
    } finally {
      setBusy(false);
    }
  };

  const verify = async (value: string): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const auth = await api.post<AuthResult>('/v1/auth/otp/verify', {
        phone: normalised(phone),
        code: value,
        device: { platform: 'web', deviceId: deviceFingerprint() },
      });
      onAuthenticated(auth);
    } catch (cause) {
      setCode('');
      errors(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="phone-frame flex min-h-dvh flex-col justify-center py-10">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-card bg-brand text-2xl text-brandInk">
          ⛽
        </div>
        <h1 className="text-2xl font-bold">{t('login.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('login.subtitle')}</p>
      </div>

      {info ? <Notice tone="info">{info}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      {step === 'phone' ? (
        <>
          <FormField label={t('form.phone')} hint={t('form.phoneHint')} required>
            {(field) => (
              <input
                {...field}
                className="input tnum text-center"
                dir="ltr"
                inputMode="tel"
                autoComplete="tel"
                placeholder={t('login.phonePlaceholder')}
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void requestCode();
                }}
              />
            )}
          </FormField>
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={busy}
            onClick={() => void requestCode()}
          >
            {busy ? t('login.sending') : t('login.request')}
          </button>
          <p className="mt-4 text-center text-xs text-muted">{t('login.devHint')}</p>
        </>
      ) : (
        <>
          <OtpInput
            length={length}
            value={code}
            autoFocus
            disabled={busy}
            invalid={Boolean(error)}
            onChange={setCode}
            onComplete={(value) => void verify(value)}
          />
          <button
            type="button"
            className="btn btn-primary mt-4 w-full"
            disabled={busy || code.length < length}
            onClick={() => void verify(code)}
          >
            {busy ? t('login.verifying') : t('login.verify')}
          </button>
          <div className="mt-3 flex items-center justify-between text-xs">
            <button
              type="button"
              className="btn btn-ghost px-2"
              onClick={() => {
                setStep('phone');
                setCode('');
                setError(null);
              }}
            >
              {t('login.changePhone')}
            </button>
            <button
              type="button"
              className="btn btn-ghost px-2 tnum"
              disabled={busy || cooldown > 0}
              onClick={() => void requestCode()}
            >
              {cooldown > 0
                ? tf('otp.resendIn', { seconds: toPersianDigits(cooldown) })
                : t('otp.resend')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const errorMap: Record<string, string> = {
  NETWORK: t('errors.NETWORK'),
  UNKNOWN: t('errors.UNKNOWN'),
  OTP_INVALID: t('errors.OTP_INVALID'),
  OTP_EXPIRED: t('errors.OTP_EXPIRED'),
  OTP_ATTEMPTS_EXCEEDED: t('errors.OTP_ATTEMPTS_EXCEEDED'),
  RATE_LIMITED: t('errors.RATE_LIMITED'),
  VALIDATION_ERROR: t('errors.VALIDATION_ERROR'),
  PHONE_LOCKED: t('errors.PHONE_LOCKED'),
  ACCOUNT_SUSPENDED: t('errors.ACCOUNT_SUSPENDED'),
};

/** Stable per-browser id so the device list in the profile stays readable. */
export function deviceFingerprint(): string {
  const KEY = 'benzin.web.device';
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const created = `web-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(KEY, created);
    return created;
  } catch {
    return 'web-unknown';
  }
}
