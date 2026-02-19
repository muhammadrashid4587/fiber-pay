import { useCallback, useEffect, useState } from 'react';

export interface UsePollingResult<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
  refresh: () => Promise<void>;
}

export function usePolling<T>(fn: () => Promise<T>, intervalMs: number): UsePollingResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await fn();
      setData(next);
      setError(undefined);
    } catch (unknownError) {
      const nextError = unknownError instanceof Error ? unknownError : new Error(String(unknownError));
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, [fn]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) {
        return;
      }
      await refresh();
    };

    void run();
    const timer = setInterval(() => {
      void run();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs, refresh]);

  return { data, loading, error, refresh };
}
