import { useCallback, useEffect, useRef, useState } from "react";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) || "/api";

export async function apiGet<T = any>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
export async function apiPost<T = any>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`, { method: "POST" });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}
export const apiUrl = (path: string) => `${BASE}${path}`;

/** Fetch with loading/error state; re-runs when `path` changes. */
export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const load = useCallback(() => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    apiGet<T>(path)
      .then((d) => {
        if (id === seq.current) setData(d);
      })
      .catch((e) => {
        if (id === seq.current) setError(String(e.message || e));
      })
      .finally(() => {
        if (id === seq.current) setLoading(false);
      });
  }, [path]);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}
