/**
 * Persian presentation helpers. All user-facing numbers/dates go through here so the
 * whole product renders Persian digits, Jalali dates and the Tehran timezone.
 */

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'] as const;
const TEHRAN_TZ = 'Asia/Tehran';

/** Converts ASCII digits in a string to Persian digits. Non-digit characters are untouched. */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)] ?? d);
}

/** Converts Persian/Arabic-Indic digits back to ASCII (for parsing user input). */
export function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

/** Groups thousands with the Persian separator U+066C instead of an ASCII comma. */
const groupThousands = (n: number): string => n.toLocaleString('en-US').replace(/,/g, '\u066C');

/** 1500000 → "۱٬۵۰۰٬۰۰۰ تومان" */
export function formatToman(amount: number): string {
  if (!Number.isFinite(amount)) throw new RangeError('amount must be a finite number');
  return `${toPersianDigits(groupThousands(Math.round(amount)))} تومان`;
}

/** 12.5 → "۱۲٫۵ لیتر" */
export function formatLitres(litres: number): string {
  if (!Number.isFinite(litres)) throw new RangeError('litres must be a finite number');
  const text = Number.isInteger(litres) ? String(litres) : String(litres).replace('.', '٫');
  return `${toPersianDigits(text)} لیتر`;
}

/** 1.500 → "۱٬۵۰۰" (per-litre price without the unit) */
export function formatRate(rateToman: number): string {
  return toPersianDigits(groupThousands(Math.round(rateToman)));
}

const jalaliDate = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const jalaliDateTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ,
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const jalaliTime = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
  timeZone: TEHRAN_TZ,
  hour: '2-digit',
  minute: '2-digit',
});

/** "۱۴۰۴ آبان ۲۲" */
export function formatJalaliDate(input: Date | string | number): string {
  return jalaliDate.format(new Date(input));
}

/** "۱۴۰۴ آبان ۲۲، ساعت ۱۸:۳۰" */
export function formatJalaliDateTime(input: Date | string | number): string {
  return jalaliDateTime.format(new Date(input));
}

/** "۱۸:۳۰" */
export function formatJalaliTime(input: Date | string | number): string {
  return jalaliTime.format(new Date(input));
}

/** "۱۲ دقیقه پیش" / "همین حالا" — used on order cards and the active-trade screen. */
export function formatRelativeFa(input: Date | string | number, now: Date = new Date()): string {
  const diffMs = new Date(input).getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const future = diffMs > 0;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < 45_000) return 'همین حالا';
  const [value, unit] =
    abs < hour
      ? [Math.round(abs / minute), 'دقیقه']
      : abs < day
        ? [Math.round(abs / hour), 'ساعت']
        : [Math.round(abs / day), 'روز'];
  return future
    ? `${toPersianDigits(value)} ${unit} دیگر`
    : `${toPersianDigits(value)} ${unit} پیش`;
}

/** Countdown "۰۲:۴۵" used for reservation expiry timers. */
export function formatCountdown(msRemaining: number): string {
  const total = Math.max(0, Math.floor(msRemaining / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return toPersianDigits(`${mm}:${ss}`);
}
