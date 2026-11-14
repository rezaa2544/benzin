import { describe, expect, it } from 'vitest';
import {
  EMPTY_ORDER_FORM,
  buyerSaving,
  officialRate,
  parseNumber,
  validateOrderForm,
  type OrderFormValues,
} from '../src/lib/order-form.js';

const bounds = { minLitres: 10, maxLitres: 200 };
const messages = {
  required: 'الزامی است',
  litresRange: 'خارج از بازه',
  rateAboveOfficial: 'بالاتر از نرخ رسمی',
  noteTooLong: 'یادداشت بلند است',
};
const values = (patch: Partial<OrderFormValues> = {}): OrderFormValues => ({
  ...EMPTY_ORDER_FORM,
  litres: '40',
  rateToman: '2500',
  ...patch,
});

describe('order form (E9-07)', () => {
  it('accepts Persian digits and thousands separators', () => {
    expect(parseNumber('۱۲۰۰')).toBe(1200);
    expect(parseNumber('1٬200')).toBe(1200);
    expect(parseNumber(' 1,200 ')).toBe(1200);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('12a')).toBeNull();
    expect(parseNumber('1.5')).toBeNull();
  });

  it('knows the official rate per tier', () => {
    expect(officialRate('T1500')).toBe(1500);
    expect(officialRate('T10000')).toBe(10000);
  });

  it('builds the create payload when the input is valid', () => {
    const result = validateOrderForm(
      values({ stationName: '  جایگاه ونک  ', note: '   ' }),
      bounds,
      messages,
    );
    expect(result.errors).toEqual({});
    expect(result.payload).toMatchObject({
      side: 'SELL',
      tier: 'T3000',
      litres: 40,
      rateToman: 2500,
      stationName: 'جایگاه ونک',
      deliveryMethod: 'FUEL_CARD',
    });
    expect(result.payload?.note).toBeUndefined();
  });

  it('rejects litres outside the configured window', () => {
    expect(validateOrderForm(values({ litres: '5' }), bounds, messages).errors.litres).toBe(
      messages.litresRange,
    );
    expect(validateOrderForm(values({ litres: '201' }), bounds, messages).errors.litres).toBe(
      messages.litresRange,
    );
    expect(validateOrderForm(values({ litres: '' }), bounds, messages).errors.litres).toBe(
      messages.required,
    );
  });

  it('never lets a rate exceed the official rate for the tier', () => {
    const tooExpensive = validateOrderForm(
      values({ tier: 'T1500', rateToman: '1600' }),
      bounds,
      messages,
    );
    expect(tooExpensive.errors.rateToman).toBe(messages.rateAboveOfficial);
    expect(tooExpensive.payload).toBeNull();
    expect(
      validateOrderForm(values({ tier: 'T1500', rateToman: '1500' }), bounds, messages).payload,
    ).not.toBeNull();
  });

  it('caps the note length and reports every field at once', () => {
    const result = validateOrderForm(
      values({ litres: '0', note: 'x'.repeat(241) }),
      bounds,
      messages,
    );
    expect(result.errors.litres).toBe(messages.litresRange);
    expect(result.errors.note).toBe(messages.noteTooLong);
  });

  it('shows the buyer saving only below the official rate', () => {
    expect(buyerSaving('40', '2500', 'T3000')).toBe(20_000);
    expect(buyerSaving('40', '3000', 'T3000')).toBeNull();
    expect(buyerSaving('', '2500', 'T3000')).toBeNull();
  });
});
