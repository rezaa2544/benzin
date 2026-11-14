import {
  formatJalaliDate,
  formatJalaliDateTime,
  formatToman,
  toPersianDigits,
} from '@benzin/shared';

/** Every number the panel shows goes through here (task E8-01): Persian digits, «٬». */
export const fmtToman = (amount: number): string => formatToman(amount);
export const fmtNumber = (value: number): string => toPersianDigits(String(value));
export const fmtDate = (iso: string | null): string =>
  iso === null ? '—' : formatJalaliDate(new Date(iso));
export const fmtDateTime = (iso: string | null): string =>
  iso === null ? '—' : formatJalaliDateTime(new Date(iso));

const STATUS_FA: Record<string, string> = {
  OPEN: 'باز',
  RESERVED: 'رزرو شده',
  CONFIRMED: 'تأییدشده',
  COMPLETED: 'تکمیل‌شده',
  EXPIRED: 'منقضی',
  CANCELLED: 'لغو‌شده',
  AWAITING_OWNER_DECISION: 'در انتظار تصمیم صاحب سفارش',
  DISPUTED: 'اختلاف',
  PENDING: 'در انتظار',
  ACTIVE: 'فعال',
  PAID: 'پرداخت‌شده',
  FAILED: 'ناموفق',
  NEEDS_REVIEW: 'نیازمند بررسی',
  PENDING_OWNER: 'در انتظار صاحب سفارش',
  AUTO_COMPLETED: 'تکمیل خودکار',
  CANCELLED_BY_TAKER: 'لغو توسط خریدار',
  CANCELLED_BY_OWNER: 'لغو توسط صاحب سفارش',
  SUSPENDED: 'تعلیق‌شده',
  BANNED: 'مسدود',
  USER: 'کاربر',
  SUPPORT: 'پشتیبانی',
  ADMIN: 'مدیر',
  OWNER: 'مالک',
  CARD_TO_CARD: 'کارت‌به‌کارت',
  GATEWAY: 'درگاه بانکی',
  SELL: 'فروش',
  BUY: 'خرید',
  T1500: 'سهمیه ۱۵۰۰',
  T3000: 'سهمیه ۳۰۰۰',
  T10000: 'سهمیه ۱۰۰۰۰',
  IN_APP: 'درون‌برنامه',
  SMS: 'پیامک',
  PUSH: 'پوش',
  PAYMENT: 'پرداخت',
  MAP: 'نقشه',
  provider: 'ارائه‌دهنده',
  zone: 'شهر',
  user: 'کاربر',
  order: 'سفارش',
  reservation: 'رزرو',
  payment: 'پرداخت',
  subscription: 'اشتراک',
  settings: 'تنظیمات',
};

export const statusFa = (status: string): string => STATUS_FA[status] ?? status;
