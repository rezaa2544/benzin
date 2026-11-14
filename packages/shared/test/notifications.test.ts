import { describe, expect, it } from 'vitest';
import { CANCEL_REASONS } from '../src/enums.js';
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_TEMPLATES,
  SMS_NOTIFICATION_KINDS,
  CANCEL_REASON_FA,
  renderNotification,
} from '../src/notifications.js';

/** Params every template needs; also doubles as the contract for callers. */
const REQUIRED_PARAMS: Record<string, Record<string, number | string>> = {
  RESERVATION_REQUESTED: { litres: 20, minutes: 5 },
  RESERVATION_CONFIRMED: { litres: 20 },
  RESERVATION_REJECTED: { litres: 20 },
  RESERVATION_EXPIRED: { litres: 20, minutes: 5 },
  RESERVATION_CANCELLED: { by: 'خریدار', litres: 20, reason: 'منصرف شدم' },
  TRADE_COMPLETED: { litres: 20, rateToman: 2600 },
  TRADE_AUTO_COMPLETED: { litres: 20, hours: 2 },
  DISPUTE_OPENED: { litres: 20 },
  ORDER_EXPIRED: { litres: 20 },
  CONTACT_SHARED: { by: 'صاحب سفارش' },
  CHAT_MESSAGE: { by: 'خریدار', litres: 20 },
};

const placeholders = (template: string): string[] =>
  [...template.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1] ?? '');

const latinAfterPlaceholders = (template: string): string =>
  template.replace(/\{[a-zA-Z0-9_]+\}/g, '');

describe('notification templates', () => {
  it('has a template for every kind, and none for retired kinds', () => {
    expect(Object.keys(NOTIFICATION_TEMPLATES).sort()).toEqual([...NOTIFICATION_KINDS].sort());
    for (const kind of NOTIFICATION_KINDS) {
      const template = NOTIFICATION_TEMPLATES[kind];
      expect(template.titleFa.trim().length).toBeGreaterThan(0);
      expect(template.bodyFa.trim().length).toBeGreaterThan(0);
    }
  });

  it('keeps the copy Persian — no Latin letters outside placeholders', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const template = NOTIFICATION_TEMPLATES[kind];
      for (const text of [template.titleFa, template.bodyFa, template.smsFa ?? '']) {
        expect(latinAfterPlaceholders(text)).not.toMatch(/[A-Za-z]/);
      }
    }
  });

  it('documents exactly the placeholders each template uses', () => {
    for (const kind of NOTIFICATION_KINDS) {
      const template = NOTIFICATION_TEMPLATES[kind];
      const used = new Set([
        ...placeholders(template.titleFa),
        ...placeholders(template.bodyFa),
        ...placeholders(template.smsFa ?? ''),
      ]);
      expect([...used].sort()).toEqual(Object.keys(REQUIRED_PARAMS[kind] ?? {}).sort());
    }
  });

  it('renders numbers with Persian digits and the Toman separator', () => {
    const rendered = renderNotification('TRADE_COMPLETED', { litres: 20, rateToman: 2600 });
    expect(rendered.bodyFa).toBe(
      'معامله ۲۰ لیتر با نرخ ۲٬۶۰۰ تومان تکمیل شد و در کارنامه شما ثبت شد.',
    );
    expect(rendered.kind).toBe('TRADE_COMPLETED');

    const request = renderNotification('RESERVATION_REQUESTED', { litres: 20, minutes: 5 });
    expect(request.titleFa).toBe('درخواست رزرو جدید');
    expect(request.bodyFa).toContain('۲۰ لیتر');
    expect(request.bodyFa).toContain('۵ دقیقه');
    expect(request.smsBodyFa).toBeNull();
  });

  it('fails fast when a template parameter is missing', () => {
    expect(() => renderNotification('TRADE_COMPLETED', { litres: 20 })).toThrow(RangeError);
    expect(() => renderNotification('CHAT_MESSAGE', {})).toThrow(/Missing notification param/);
  });

  it('rejects unknown kinds instead of emitting empty copy', () => {
    expect(() => renderNotification('NOPE' as never, {})).toThrow(RangeError);
  });

  it('keeps SMS copy inside a single Persian segment', () => {
    expect(SMS_NOTIFICATION_KINDS.length).toBeGreaterThan(0);
    for (const kind of SMS_NOTIFICATION_KINDS) {
      const sms = NOTIFICATION_TEMPLATES[kind].smsFa;
      expect(sms).not.toBeNull();
      expect((sms ?? '').length).toBeLessThanOrEqual(70);
    }
  });

  it('labels every cancel reason in Persian', () => {
    for (const reason of CANCEL_REASONS) {
      expect(CANCEL_REASON_FA[reason]).toMatch(/[\u0600-\u06FF]/);
    }
    expect(Object.keys(CANCEL_REASON_FA).sort()).toEqual([...CANCEL_REASONS].sort());
  });
});
