import {
  ORDER_SIDE_FA,
  ORDER_STATUS_FA,
  formatLitres,
  formatRate,
  formatToman,
  toPersianDigits,
  type OrderSide,
  type OrderStatus,
} from '@benzin/shared';

export interface OrderCardInput {
  side: OrderSide;
  status: OrderStatus;
  litres: number;
  rateToman: number;
  zoneName: string;
  ownerName?: string;
  score?: number;
}

export interface OrderCardView {
  side: string;
  status: string;
  litres: string;
  rate: string;
  total: string;
  zoneName: string;
  ownerName: string | null;
  /** SELL offers green, BUY requests amber — used for the card's start border. */
  tone: 'brand' | 'accent';
}

/**
 * Turns a wire order into display-ready Persian strings. The total is litres × rate, the
 * same formula the API validates, and every number goes through the shared formatters so
 * digits and separators match the rest of the product.
 */
export function orderCardView(order: OrderCardInput): OrderCardView {
  const total = Math.round(order.litres * order.rateToman);
  return {
    side: ORDER_SIDE_FA[order.side],
    status: ORDER_STATUS_FA[order.status],
    litres: formatLitres(order.litres),
    rate: formatRate(order.rateToman),
    total: formatToman(total),
    zoneName: order.zoneName,
    ownerName: order.ownerName ?? null,
    tone: order.side === 'SELL' ? 'brand' : 'accent',
  };
}

/** Remaining-litres summary for the market header. */
export function litresSummary(litres: number, orders: number): string {
  return `${formatLitres(litres)} در ${toPersianDigits(orders)} سفارش`;
}
