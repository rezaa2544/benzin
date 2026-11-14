import { haversineMeters } from '../domain/geo.js';
import type { RouteProvider, RouteResult } from '../ports.js';

/** Urban detour factor: straight-line distance underestimates real driving. */
export const ROAD_FACTOR = 1.35;
/** Conservative average speed inside a small city, in km/h. */
export const AVERAGE_SPEED_KMH = 32;
/** A slow routing provider must never stall a request. */
export const PROVIDER_TIMEOUT_MS = 1_500;

export interface RouteEstimate {
  distanceMeters: number;
  durationSeconds: number;
  etaMinutes: number;
  /** True whenever the numbers came from the fallback instead of a real router. */
  approximate: boolean;
  source: 'provider' | 'straight-line';
}

const isValid = (result: RouteResult | null | undefined): result is RouteResult =>
  !!result &&
  Number.isFinite(result.distanceMeters) &&
  Number.isFinite(result.durationSeconds) &&
  result.distanceMeters >= 0 &&
  result.durationSeconds >= 0;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('route provider timed out')), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/** Offline router used when no provider is configured; also the fallback. */
export class StraightLineRouteProvider implements RouteProvider {
  async route(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<RouteResult> {
    const distanceMeters = Math.round(haversineMeters(from, to) * ROAD_FACTOR);
    const durationSeconds = Math.round(distanceMeters / ((AVERAGE_SPEED_KMH * 1_000) / 3_600));
    return { distanceMeters, durationSeconds };
  }
}

export class DistanceService {
  constructor(private readonly provider: RouteProvider | null = null) {}

  async estimate(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
  ): Promise<RouteEstimate> {
    if (this.provider) {
      try {
        const result = await withTimeout(this.provider.route(from, to), PROVIDER_TIMEOUT_MS);
        if (isValid(result)) return this.toEstimate(result, false, 'provider');
        // An invalid answer is treated exactly like an outage.
      } catch {
        // Silent fallback is an explicit acceptance criterion (task E2-03).
      }
    }
    const fallback = await new StraightLineRouteProvider().route(from, to);
    return this.toEstimate(fallback, true, 'straight-line');
  }

  private toEstimate(
    result: RouteResult,
    approximate: boolean,
    source: RouteEstimate['source'],
  ): RouteEstimate {
    return {
      distanceMeters: Math.round(result.distanceMeters),
      durationSeconds: Math.round(result.durationSeconds),
      etaMinutes: Math.max(1, Math.round(result.durationSeconds / 60)),
      approximate,
      source,
    };
  }
}
