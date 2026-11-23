import { useCallback, useEffect, useState } from 'react';
import { getEvent, HttpError, type EventItem } from '../services/events';

export type EventLoadState = 'loading' | 'ok' | 'notFound' | 'error';

type Result = { key: string; state: Exclude<EventLoadState, 'loading'>; event: EventItem | null };

export function useEvent(id: string, token?: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const key = `${id}#${attempt}`;

  useEffect(() => {
    let live = true;
    getEvent(id, token)
      .then((event) => { if (live) setResult({ key, state: 'ok', event }); })
      .catch((e) => {
        if (live) setResult({ key, state: e instanceof HttpError && e.status === 404 ? 'notFound' : 'error', event: null });
      });
    return () => { live = false; };
  }, [id, token, key]);

  const retry = useCallback(() => { setResult(null); setAttempt((a) => a + 1); }, []);
  const current = result && result.key === key ? result : null;
  return { state: (current?.state ?? 'loading') as EventLoadState, event: current?.event ?? null, retry };
}
