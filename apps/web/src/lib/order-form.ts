import { TIER_RATE_TOMAN, type OrderSide, type Tier } from '@benzin/shared';
import { toAsciiDigits } from '@benzin/shared';

export interface OrderFormValues {
  side: OrderSide;
  tier: Tier;
  litres: string;
  rateToman: string;
  stationName: string;
  note: string;
}

export type OrderFormErrors = Partial<Record<keyof OrderFormValues, string>>;

export interface OrderFormBounds {
  minLitres: number;
  maxLitres: number;
}

export const EMPTY_ORDER_FORM: OrderFormValues = {
  side: 'SELL',
  tier: 'T3000',
  litres: '',
  rateToman: '',
  stationName: '',
  note: '',
};

/** Accepts Persian digits and thousands separators; returns a plain number or null. */
export function parseNumber(input: string): number | null {
  const clean = toAsciiDigits(input).replace(/[٬,\s]/g, '');
  if (!/^\d+$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

export const officialRate = (tier: Tier): number => TIER_RATE_TOMAN[tier];

/**
 * Client-side mirror of the API rules (E9-07): litres inside the configured window and a
 * rate that never exceeds the official tier rate. The server stays the authority; this
 * just keeps obviously bad input from making a round trip.
 */
export function validateOrderForm(
  values: OrderFormValues,
  bounds: OrderFormBounds,
  messages: {
    required: string;
    litresRange: string;
    rateAboveOfficial: string;
    noteTooLong: string;
  },
): {
  errors: OrderFormErrors;
  payload: {
    side: OrderSide;
    tier: Tier;
    litres: number;
    rateToman: number;
    stationName?: string;
    note?: string;
    deliveryMethod: 'FUEL_CARD';
  } | null;
} {
  const errors: OrderFormErrors = {};
  const litres = parseNumber(values.litres);
  const rate = parseNumber(values.rateToman);

  if (litres === null) errors.litres = messages.required;
  else if (litres < bounds.minLitres || litres > bounds.maxLitres)
    errors.litres = messages.litresRange;

  if (rate === null) errors.rateToman = messages.required;
  else if (rate > officialRate(values.tier)) errors.rateToman = messages.rateAboveOfficial;

  if (values.note.length > 240) errors.note = messages.noteTooLong;

  const payload =
    Object.keys(errors).length === 0 && litres !== null && rate !== null
      ? {
          side: values.side,
          tier: values.tier,
          litres,
          rateToman: rate,
          stationName: values.stationName.trim() || undefined,
          note: values.note.trim() || undefined,
          deliveryMethod: 'FUEL_CARD' as const,
        }
      : null;

  return { errors, payload };
}

/** Savings shown live under the rate field while the user types. */
export function buyerSaving(litres: string, rate: string, tier: Tier): number | null {
  const litresValue = parseNumber(litres);
  const rateValue = parseNumber(rate);
  if (litresValue === null || rateValue === null) return null;
  const official = officialRate(tier);
  if (rateValue >= official) return null;
  return (official - rateValue) * litresValue;
}
