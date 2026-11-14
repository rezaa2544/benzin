import { useEffect, useRef } from 'react';
import { toAsciiDigits, toPersianDigits } from '@benzin/shared';
import { t } from '../lib/i18n.js';

export interface OtpInputProps {
  length?: number;
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
}

const DIGIT = /^[0-9]$/;

/**
 * Segmented OTP field. Persian digits are normalised on input, paste fills the whole code,
 * backspace clears and steps back, and the boxes are laid out LTR because a code is not
 * RTL text — while the caption around it stays RTL.
 */
export function OtpInput({
  length = 5,
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = false,
  invalid = false,
}: OtpInputProps): JSX.Element {
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = value.padEnd(length, ' ').split('').slice(0, length);

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  const commit = (next: string): void => {
    const clean = toAsciiDigits(next)
      .replace(/[^0-9]/g, '')
      .slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
  };

  return (
    <div className="flex flex-col gap-2">
      <div dir="ltr" className="flex justify-center gap-2">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(node) => {
              refs.current[index] = node;
            }}
            value={digit.trim() ? toPersianDigits(digit.trim()) : ''}
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            disabled={disabled}
            aria-label={`${t('otp.label')} ${toPersianDigits(index + 1)}`}
            aria-invalid={invalid}
            className={`input h-12 w-11 text-center text-lg font-bold tnum ${invalid ? 'border-danger' : ''}`}
            onChange={(event) => {
              const typed = toAsciiDigits(event.target.value).replace(/[^0-9]/g, '');
              if (!typed) {
                commit(value.slice(0, index) + value.slice(index + 1));
                return;
              }
              const next = (value.slice(0, index) + typed + value.slice(index + 1)).slice(
                0,
                length,
              );
              commit(next);
              refs.current[Math.min(index + typed.length, length - 1)]?.focus();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Backspace' && !digits[index]?.trim() && index > 0) {
                event.preventDefault();
                commit(value.slice(0, index - 1) + value.slice(index));
                refs.current[index - 1]?.focus();
              }
              if (event.key === 'ArrowLeft' && index < length - 1) refs.current[index + 1]?.focus();
              if (event.key === 'ArrowRight' && index > 0) refs.current[index - 1]?.focus();
            }}
            onPaste={(event) => {
              const pasted = toAsciiDigits(event.clipboardData.getData('text')).replace(
                /[^0-9]/g,
                '',
              );
              if (!pasted) return;
              event.preventDefault();
              commit(pasted);
              refs.current[Math.min(pasted.length, length - 1)]?.focus();
            }}
          />
        ))}
      </div>
      <p className="text-center text-xs text-muted">{t('otp.hint')}</p>
    </div>
  );
}

/** True when a pasted/typed code has the expected length and only ASCII digits. */
export function isCompleteOtp(code: string, length = 5): boolean {
  const ascii = toAsciiDigits(code);
  return ascii.length === length && Array.from(ascii).every((char) => DIGIT.test(char));
}
