import { useEffect, useRef, useState } from 'react';

type Result<T> = { key: string; rows: T[] | null };

export function useAdminList<T>(load: () => Promise<T[]>, deps: readonly unknown[]) {
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<Result<T> | null>(null);
  const key = JSON.stringify([...deps, reloadKey]);
  const loadRef = useRef(load);

  useEffect(() => { loadRef.current = load; });

  useEffect(() => {
    let live = true;
    loadRef.current()
      .then((rows) => { if (live) setResult({ key, rows }); })
      .catch(() => { if (live) setResult({ key, rows: null }); });
    return () => { live = false; };
  }, [key]);

  const current = result?.key === key ? result : null;
  return {
    state: (current === null ? 'loading' : current.rows === null ? 'error' : 'ok') as 'loading' | 'error' | 'ok',
    rows: current?.rows ?? [],
    reload: () => setReloadKey((k) => k + 1),
  };
}
