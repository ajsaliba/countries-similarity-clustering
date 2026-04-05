import { useState, useCallback } from 'react';

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  execute: (body?: unknown) => Promise<T | null>;
  clearError: () => void;
}

export function useApi<T>(url: string, options?: RequestInit): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const execute = useCallback(
    async (body?: unknown): Promise<T | null> => {
      setLoading(true);
      setError(null);
      try {
        const fetchOptions: RequestInit = {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            ...(options?.headers ?? {}),
          },
        };
        if (body !== undefined) {
          fetchOptions.body = JSON.stringify(body);
          fetchOptions.method = fetchOptions.method ?? 'POST';
        }
        const res = await fetch(url, fetchOptions);
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const errJson = await res.json() as { error?: string };
            if (errJson.error) msg = errJson.error;
          } catch { /* ignore */ }
          throw new Error(msg);
        }
        const result = await res.json() as T;
        setData(result);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [url, options],
  );

  return { data, loading, error, execute, clearError };
}