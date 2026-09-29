import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { getLocation } from './tg';

/** Загрузка с кэшем в памяти: при повторном открытии экрана данные показываются сразу, потом обновляются. */
const memo = new Map<string, unknown>();

export function useApi<T>(path: string | null, opts: { refreshMs?: number } = {}) {
  const [data, setData] = useState<T | null>(() => (path ? ((memo.get(path) as T) ?? null) : null));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!data);
  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(async () => {
    if (!path) return;
    setLoading(true);
    try {
      const d = await api.get<T>(path);
      memo.set(path, d);
      if (pathRef.current === path) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (pathRef.current === path) setError((e as Error).message);
    } finally {
      if (pathRef.current === path) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (!path) return;
    const cached = memo.get(path) as T | undefined;
    if (cached) setData(cached);
    load();
    if (!opts.refreshMs) return;
    const t = setInterval(load, opts.refreshMs);
    return () => clearInterval(t);
  }, [path, load, opts.refreshMs]);

  return { data, error, loading, reload: load, setData };
}

/** Тикает раз в N мс — для обратных отсчётов. */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

let lastLocation: { lat: number; lon: number } | null = null;

export function useLocation(auto = true) {
  const [loc, setLoc] = useState(lastLocation);
  const [asking, setAsking] = useState(false);
  const request = useCallback(async () => {
    setAsking(true);
    const l = await getLocation();
    setAsking(false);
    if (l) {
      lastLocation = l;
      setLoc(l);
    }
    return l;
  }, []);
  useEffect(() => {
    if (auto && !lastLocation) request();
  }, [auto, request]);
  return { loc, asking, request };
}

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch { /* приватный режим */ }
    },
    [key],
  );
  return [value, set] as const;
}
