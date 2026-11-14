import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@benzin/shared';
import {
  buildSettingRows,
  collectChanges,
  groupSettings,
  parseSettingInput,
} from '../src/lib/settings-form.js';

const rows = buildSettingRows(DEFAULT_SETTINGS);

describe('settings form model (E8-05)', () => {
  it('renders one row per key with bounds from the shared schema', () => {
    expect(rows).toHaveLength(Object.keys(DEFAULT_SETTINGS).length);
    const ttl = rows.find((row) => row.key === 'reservation.ttl_minutes');
    expect(ttl).toMatchObject({ kind: 'number', min: 1, max: 120, value: '10' });
    expect(rows.find((row) => row.key === 'notification.sms_enabled')?.kind).toBe('boolean');
    expect(rows.find((row) => row.key === 'chat.quick_replies')?.kind).toBe('list');
  });

  it('groups rows without empty sections', () => {
    const sections = groupSettings(rows);
    expect(sections.every((section) => section.rows.length > 0)).toBe(true);
    expect(sections.flatMap((section) => section.rows)).toHaveLength(rows.length);
  });

  it('validates numbers against the schema bounds and accepts Persian digits', () => {
    const row = rows.find((item) => item.key === 'otp.max_attempts')!;
    expect(parseSettingInput(row, '3')).toEqual({ ok: true, value: 3 });
    expect(parseSettingInput(row, '۳').value).toBe(3);
    expect(parseSettingInput(row, '99').ok).toBe(false);
    expect(parseSettingInput(row, '0').ok).toBe(false);
    expect(parseSettingInput(row, 'abc').ok).toBe(false);
  });

  it('splits list settings and rejects an empty list', () => {
    const row = rows.find((item) => item.key === 'chat.quick_replies')!;
    expect(parseSettingInput(row, 'سلام، در مسیرم، رسیدم').value).toEqual([
      'سلام',
      'در مسیرم',
      'رسیدم',
    ]);
    expect(parseSettingInput(row, '  ').ok).toBe(false);
  });

  it('only sends edited keys and reports invalid ones', () => {
    const { patch, errors } = collectChanges(rows, {
      'reservation.ttl_minutes': '15',
      'otp.max_attempts': '500',
      'notification.sms_enabled': false,
    });
    expect(patch).toEqual({
      'reservation.ttl_minutes': 15,
      'notification.sms_enabled': false,
    });
    expect(Object.keys(errors)).toEqual(['otp.max_attempts']);

    const untouched = collectChanges(rows, { 'reservation.ttl_minutes': '10' });
    expect(untouched.patch).toEqual({});
  });
});
