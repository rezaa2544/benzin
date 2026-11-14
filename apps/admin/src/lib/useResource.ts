import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.js';

/**
 * Minimal data hook (task E8-01): one dependency array, one reload function, no cache
 * library. The panel's screens are independent, so stale-while-revalidate buys nothing.
 */
export interface ResourceState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  reload: () => void;
}

export function useResource<T>(loader: () => Promise<T>, deps: unknown[]): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const key = JSON.stringify([...deps, nonce]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loaderRef
      .current()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setError(caught instanceof ApiError ? caught : new ApiError('NETWORK', 0, 'خطای نامشخص'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [key]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  return { data, error, loading, reload };
}
