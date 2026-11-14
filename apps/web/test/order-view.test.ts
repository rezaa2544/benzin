import { describe, expect, it } from 'vitest';
import { ORDER_SIDE_FA, ORDER_STATUSES, ORDER_STATUS_FA } from '@benzin/shared';
import { litresSummary, orderCardView } from '../src/lib/order-view.js';
import { tierView } from '../src/lib/tier.js';

describe('order card model (E9-02)', () => {
  it('computes the total from litres × rate with Persian formatting', () => {
    const view = orderCardView({
      side: 'SELL',
      status: 'OPEN',
      litres: 30,
      rateToman: 9800,
      zoneName: 'بانه',
    });
    expect(view.total).toBe('۲۹۴٬۰۰۰ تومان');
    expect(view.litres).toContain('۳۰');
    expect(view.rate).toContain('۹٬۸۰۰');
    expect(view.side).toBe('فروش سهمیه');
    expect(view.status).toBe('باز');
    expect(view.tone).toBe('brand');
    expect(view.ownerName).toBeNull();
  });

  it('colours buy requests with the accent token', () => {
    expect(
      orderCardView({ side: 'BUY', status: 'OPEN', litres: 10, rateToman: 12000, zoneName: 'بانه' })
        .tone,
    ).toBe('accent');
  });

  it('has Persian copy for every order status and side the API can return', () => {
    for (const status of ORDER_STATUSES) {
      expect(ORDER_STATUS_FA[status]).toBeTruthy();
    }
    expect(ORDER_SIDE_FA.BUY).toBe('خرید سهمیه');
  });
});

describe('tier view (E9-02)', () => {
  it('maps scores to the shared thresholds and matching colours', () => {
    expect(tierView(90)).toMatchObject({ level: 'GOLD', label: 'طلایی', tone: 'text-gold' });
    expect(tierView(50)).toMatchObject({ level: 'SILVER', label: 'نقره‌ای' });
    expect(tierView(49)).toMatchObject({ level: 'BRONZE', label: 'برنزی' });
    expect(tierView(0).level).toBe('BRONZE');
  });
});

describe('market summary (E9-05 prep)', () => {
  it('counts orders in Persian digits', () => {
    expect(litresSummary(120, 4)).toContain('۱۲۰');
    expect(litresSummary(120, 4)).toContain('۴');
  });
});
