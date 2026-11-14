import { formatRate, formatLitres, formatToman } from '@benzin/shared';
import { t } from '../lib/i18n.js';

export interface PriceTagProps {
  rateToman: number;
  litres?: number;
  size?: 'sm' | 'md';
}

/**
 * Rate and (optionally) the order total. Both numbers use the shared formatters, so the
 * Persian separator and digits are identical everywhere money is shown.
 */
export function PriceTag({ rateToman, litres, size = 'md' }: PriceTagProps): JSX.Element {
  const big = size === 'md';
  return (
    <div className="flex flex-col gap-0.5">
      <div className={`flex items-baseline gap-1 ${big ? 'text-lg' : 'text-sm'}`}>
        <span className="font-bold tnum">{formatRate(rateToman)}</span>
        <span className="text-xs text-muted">{t('common.perLitre')}</span>
      </div>
      {litres !== undefined ? (
        <div className="flex items-center gap-1 text-xs text-muted">
          <span className="tnum">{formatLitres(litres)}</span>
          <span aria-hidden="true">·</span>
          <span className="tnum font-medium text-ink">
            {formatToman(Math.round(litres * rateToman))} {t('common.toman')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
