/** Percentile helpers used by the market-rate statistics (task E3-06). */

export function median(values: readonly number[]): number | null {
  return percentile(values, 50);
}

/** Linear-interpolated percentile; `null` for an empty sample. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const rank = (Math.min(Math.max(p, 0), 100) / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower]!;
  const weight = rank - lower;
  return Math.round(sorted[lower]! * (1 - weight) + sorted[upper]! * weight);
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}
