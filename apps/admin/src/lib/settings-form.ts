import {
  SETTING_GROUPS,
  SETTING_KEYS,
  SETTING_META,
  settingBounds,
  settingKind,
  type SettingGroup,
  type SettingKey,
  type SettingKind,
  type Settings,
} from '@benzin/shared';

/**
 * Settings form model (task E8-05). The panel renders one row per key and validates
 * locally with the same bounds the API enforces, so a typo never becomes a 422.
 */

export interface SettingRow {
  key: SettingKey;
  labelFa: string;
  group: SettingGroup;
  groupFa: string;
  kind: SettingKind;
  min: number | null;
  max: number | null;
  value: string | boolean;
}

const GROUP_FA: Record<SettingGroup, string> = {
  ORDER: 'سفارش',
  RESERVATION: 'رزرو',
  TRADE: 'معامله',
  CHAT: 'گفتگو',
  AUTH: 'احراز هویت',
  PRICING: 'قیمت‌گذاری',
  PAYMENT: 'پرداخت',
  TRUST: 'اعتماد',
  GEO: 'جغرافیا',
  OPS: 'عملیات',
};

const toEditable = (value: unknown): string | boolean => {
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.join('، ');
  if (typeof value === 'number') return String(value);
  return String(value ?? '');
};

export const buildSettingRows = (settings: Settings): SettingRow[] =>
  SETTING_KEYS.map((key) => {
    const bounds = settingBounds(key);
    return {
      key,
      labelFa: SETTING_META[key].labelFa,
      group: SETTING_META[key].group,
      groupFa: GROUP_FA[SETTING_META[key].group],
      kind: settingKind(key),
      min: bounds.min,
      max: bounds.max,
      value: toEditable(settings[key]),
    };
  });

export const groupSettings = (
  rows: SettingRow[],
): { group: SettingGroup; labelFa: string; rows: SettingRow[] }[] =>
  SETTING_GROUPS.map((group) => ({
    group,
    labelFa: GROUP_FA[group],
    rows: rows.filter((row) => row.group === group),
  })).filter((section) => section.rows.length > 0);

export interface SettingParseResult {
  ok: boolean;
  value?: number | boolean | string[];
  errorFa?: string;
}

const ASCII_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** Converts one edited control back into the JSON the API expects. */
export const parseSettingInput = (row: SettingRow, raw: string | boolean): SettingParseResult => {
  if (row.kind === 'boolean') return { ok: true, value: raw === true };
  if (row.kind === 'list') {
    const text = String(raw).trim();
    if (text.length === 0) return { ok: false, errorFa: 'حداقل یک مورد لازم است.' };
    return {
      ok: true,
      value: text
        .split(/[،,\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    };
  }
  const normalised = String(raw)
    .trim()
    .replace(/[۰-۹]/g, (digit) => String(ASCII_DIGITS.indexOf(digit)));
  const numeric = Number(normalised);
  if (normalised.length === 0 || !Number.isFinite(numeric)) {
    return { ok: false, errorFa: 'عدد معتبر وارد کنید.' };
  }
  if (row.min !== null && numeric < row.min) {
    return { ok: false, errorFa: `کمتر از حداقل مجاز (${row.min}) است.` };
  }
  if (row.max !== null && numeric > row.max) {
    return { ok: false, errorFa: `بیشتر از حداکثر مجاز (${row.max}) است.` };
  }
  return { ok: true, value: numeric };
};

/** Builds the PATCH body, skipping controls the operator did not touch. */
export const collectChanges = (
  rows: SettingRow[],
  edits: Record<string, string | boolean>,
): { patch: Record<string, unknown>; errors: Record<string, string> } => {
  const patch: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const row of rows) {
    const edited = edits[row.key];
    if (edited === undefined || edited === row.value) continue;
    const parsed = parseSettingInput(row, edited);
    if (!parsed.ok) {
      errors[row.key] = parsed.errorFa ?? 'مقدار نامعتبر';
      continue;
    }
    patch[row.key] = parsed.value;
  }
  return { patch, errors };
};
