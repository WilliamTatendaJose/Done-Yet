import { useEffect, useRef, useState } from 'react';
import type { BusyCheck } from '../../../../src/domain/busy';
import { checkDeadlineBusy } from './native';

/**
 * Debounced busy-check for whatever deadline is currently being edited. Only runs while `enabled`
 * (Settings > "Warn about calendar conflicts") is on and there is a deadline to check; the read
 * itself is a narrow window around that one deadline (see checkDeadlineBusy), never the whole
 * calendar, and only the {busy,count} result is ever kept here — no event data.
 */
export function useBusyWarning(enabled: boolean, dueAt: Date | null) {
  const [result, setResult] = useState<BusyCheck | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const token = useRef(0);
  const dueAtMs = dueAt?.getTime() ?? null;
  useEffect(() => {
    const mine = ++token.current;
    if (!enabled || dueAtMs === null) { setResult(null); setError(''); setChecking(false); return; }
    setChecking(true);
    const timer = setTimeout(() => {
      checkDeadlineBusy(new Date(dueAtMs).toISOString(), new Date())
        .then(check => { if (token.current === mine) { setResult(check); setError(''); } })
        .catch((e: unknown) => { if (token.current === mine) { setResult(null); setError(e instanceof Error ? e.message : 'Could not check your calendar.'); } })
        .finally(() => { if (token.current === mine) setChecking(false); });
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, dueAtMs]);
  return { result, error, checking };
}
