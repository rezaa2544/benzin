import { useState } from 'react';
import { canAccess } from '../lib/permissions.js';
import type { AuthResponse } from '../lib/types.js';
import { Field, Notice } from '../components/ui.js';
import fa from '../i18n/fa.json';

/** OTP login for staff (task E8-01): the same endpoint the customer app uses. */
export function LoginPage({ onLogin }: { onLogin: (auth: AuthResponse) => void }): JSX.Element {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'PHONE' | 'CODE'>('PHONE');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => null)) as
      (T & { error?: { code: string } }) | null;
    if (!response.ok) {
      const code = payload?.error?.code;
      setError(fa.errors[code as keyof typeof fa.errors] ?? fa.app.error);
      throw new Error(code ?? 'login failed');
    }
    return payload as T;
  };

  const requestCode = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await post('/v1/auth/otp/request', { phone });
      setStage('CODE');
    } catch {
      /* the error is already on screen */
    } finally {
      setBusy(false);
    }
  };

  const verify = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const auth = await post<AuthResponse>('/v1/auth/otp/verify', { phone, code });
      if (!canAccess(auth.user.role, 'dashboard')) {
        setError(fa.login.noAccess);
        return;
      }
      onLogin(auth);
    } catch {
      /* the error is already on screen */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        className="card w-full max-w-sm space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void (stage === 'PHONE' ? requestCode() : verify());
        }}
      >
        <div>
          <h1 className="text-lg font-bold">{fa.login.title}</h1>
          <p className="mt-1 text-xs text-muted">{fa.login.hint}</p>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {stage === 'CODE' ? <Notice>{fa.login.sent}</Notice> : null}
        <Field label={fa.login.phone}>
          <input
            className="input tnum"
            inputMode="tel"
            dir="ltr"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="09123456789"
            required
          />
        </Field>
        {stage === 'CODE' ? (
          <Field label={fa.login.code}>
            <input
              className="input tnum tracking-[0.4em]"
              inputMode="numeric"
              dir="ltr"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={6}
              required
            />
          </Field>
        ) : null}
        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {stage === 'PHONE' ? fa.login.send : fa.login.verify}
        </button>
      </form>
    </div>
  );
}
