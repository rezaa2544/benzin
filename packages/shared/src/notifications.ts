import type { CancelReason } from './enums.js';
import { formatRate } from './format.js';

/**
 * Notification vocabulary and Persian copy (tasks E5-03/E5-04).
 *
 * The API never builds a Persian sentence itself: every user-visible notification is
 * rendered from a template in this file, so copy can be reviewed in one place and the
 * same strings feed the in-app inbox and the SMS provider.
 */
export const NOTIFICATION_KINDS = [
  'RESERVATION_REQUESTED',
  'RESERVATION_CONFIRMED',
  'RESERVATION_REJECTED',
  'RESERVATION_EXPIRED',
  'RESERVATION_CANCELLED',
  'TRADE_COMPLETED',
  'TRADE_AUTO_COMPLETED',
  'DISPUTE_OPENED',
  'ORDER_EXPIRED',
  'CONTACT_SHARED',
  'CHAT_MESSAGE',
  'RATING_RECEIVED',
  'ACCOUNT_SUSPENDED',
  'ACCOUNT_RESTORED',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface NotificationTemplate {
  readonly titleFa: string;
  readonly bodyFa: string;
  /** Short copy for SMS. null means the event never leaves the app (ASSUMPTION A18). */
  readonly smsFa: string | null;
}

/** Placeholders use `{name}`; numbers are rendered with Persian digits and «٬». */
export const NOTIFICATION_TEMPLATES: Record<NotificationKind, NotificationTemplate> = {
  RESERVATION_REQUESTED: {
    titleFa: 'درخواست رزرو جدید',
    bodyFa:
      'یک خریدار سفارش {litres} لیتر شما را رزرو کرد. برای تأیید یا رد تا {minutes} دقیقه دیگر فرصت دارید.',
    smsFa: null,
  },
  RESERVATION_CONFIRMED: {
    titleFa: 'رزرو تأیید شد',
    bodyFa:
      'صاحب سفارش درخواست شما برای {litres} لیتر را تأیید کرد. برای هماهنگی تحویل، چت را باز کنید.',
    smsFa: 'رزرو شما تأیید شد. بنزین',
  },
  RESERVATION_REJECTED: {
    titleFa: 'درخواست رد شد',
    bodyFa: 'صاحب سفارش درخواست شما برای {litres} لیتر را رد کرد و سفارش به بازار برگشت.',
    smsFa: 'درخواست رزرو شما رد شد. بنزین',
  },
  RESERVATION_EXPIRED: {
    titleFa: 'مهلت تأیید تمام شد',
    bodyFa: 'صاحب سفارش در {minutes} دقیقه پاسخ نداد و رزرو {litres} لیتر شما منقضی شد.',
    smsFa: 'مهلت تأیید رزرو شما تمام شد. بنزین',
  },
  RESERVATION_CANCELLED: {
    titleFa: 'رزرو لغو شد',
    bodyFa: '{by} رزرو {litres} لیتر را لغو کرد. دلیل: {reason}',
    smsFa: null,
  },
  TRADE_COMPLETED: {
    titleFa: 'معامله تکمیل شد',
    bodyFa: 'معامله {litres} لیتر با نرخ {rateToman} تومان تکمیل شد و در کارنامه شما ثبت شد.',
    smsFa: null,
  },
  TRADE_AUTO_COMPLETED: {
    titleFa: 'تکمیل خودکار معامله',
    bodyFa: 'معامله {litres} لیتر پس از {hours} ساعت بدون گزارش مشکل، خودکار تکمیل شد.',
    smsFa: 'معامله شما خودکار تکمیل شد. در صورت مشکل گزارش دهید. بنزین',
  },
  DISPUTE_OPENED: {
    titleFa: 'اختلاف ثبت شد',
    bodyFa: 'اختلاف روی معامله {litres} لیتر ثبت شد. کارشناسان بنزین آن را بررسی می‌کنند.',
    smsFa: null,
  },
  ORDER_EXPIRED: {
    titleFa: 'سفارش منقضی شد',
    bodyFa: 'سفارش {litres} لیتر شما بدون رزرو منقضی شد. می‌توانید دوباره ثبت کنید.',
    smsFa: null,
  },
  CONTACT_SHARED: {
    titleFa: 'شماره تماس به اشتراک گذاشته شد',
    bodyFa: '{by} شماره تماس خود را در چت فرستاد. برای هماهنگی، چت را باز کنید.',
    smsFa: null,
  },
  CHAT_MESSAGE: {
    titleFa: 'پیام جدید در چت',
    bodyFa: '{by} پیام جدیدی برای سفارش {litres} لیتر فرستاد.',
    smsFa: null,
  },
  RATING_RECEIVED: {
    titleFa: 'امتیاز جدید دریافت شد',
    bodyFa: 'هم‌معامله‌ی شما {stars} از ۵ ستاره داد. امتیاز اعتبار شما اکنون {score} است.',
    smsFa: null,
  },
  ACCOUNT_SUSPENDED: {
    titleFa: 'حساب شما موقتاً تعلیق شد',
    bodyFa:
      'امتیاز اعتبار شما به {score} رسید و حساب تا {hours} ساعت محدود شد. برای بررسی با پشتیبانی تماس بگیرید.',
    smsFa: 'حساب شما موقتاً تعلیق شد. بنزین',
  },
  ACCOUNT_RESTORED: {
    titleFa: 'تعلیق حساب برداشته شد',
    bodyFa: 'محدودیت حساب شما پایان یافت. امتیاز اعتبار: {score}.',
    smsFa: 'تعلیق حساب شما برداشته شد. بنزین',
  },
};

/** Persian labels for the cancel reasons clients pick from. */
export const CANCEL_REASON_FA: Record<CancelReason, string> = {
  OWNER_UNRESPONSIVE: 'پاسخ نداده‌ی صاحب سفارش',
  CHANGED_MIND: 'منصرف شدم',
  NO_SHOW: 'حاضر نشد',
  OTHER: 'دلیل دیگر',
};

export type NotificationParams = Record<string, string | number>;

export interface RenderedNotification {
  readonly kind: NotificationKind;
  readonly titleFa: string;
  readonly bodyFa: string;
  /** null when the template has no SMS variant. */
  readonly smsBodyFa: string | null;
}

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

const formatParam = (value: string | number): string =>
  typeof value === 'number' ? formatRate(value) : value;

const fill = (template: string, kind: NotificationKind, params: NotificationParams): string =>
  template.replace(PLACEHOLDER, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new RangeError(`Missing notification param "${name}" for ${kind}`);
    }
    return formatParam(value);
  });

/**
 * Renders one notification. A missing placeholder is a programming error, not a user
 * error, so it throws instead of emitting an empty gap in a Persian sentence.
 */
export function renderNotification(
  kind: NotificationKind,
  params: NotificationParams = {},
): RenderedNotification {
  const template = NOTIFICATION_TEMPLATES[kind];
  if (!template) throw new RangeError(`Unknown notification kind: ${String(kind)}`);
  return {
    kind,
    titleFa: fill(template.titleFa, kind, params),
    bodyFa: fill(template.bodyFa, kind, params),
    smsBodyFa: template.smsFa === null ? null : fill(template.smsFa, kind, params),
  };
}

/** Kinds that are important enough to leave the app as an SMS (ASSUMPTION A18). */
export const SMS_NOTIFICATION_KINDS: readonly NotificationKind[] = NOTIFICATION_KINDS.filter(
  (kind) => NOTIFICATION_TEMPLATES[kind].smsFa !== null,
);

export const isNotificationKind = (value: unknown): value is NotificationKind =>
  typeof value === 'string' && (NOTIFICATION_KINDS as readonly string[]).includes(value);
