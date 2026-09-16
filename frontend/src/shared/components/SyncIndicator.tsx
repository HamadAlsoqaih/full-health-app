/**
 * Shows how many writes are waiting in the offline outbox.
 *
 * Renders nothing when the queue is empty, which is almost always. It exists for
 * the case that would otherwise be silent and alarming: the user logged a workout
 * in a basement gym, saw it appear, and has no way to tell whether it is safe.
 *
 * It also drives the auto-flush, so connectivity returning is enough to sync —
 * the user never has to find a button.
 */
import { useEffect, useState } from 'react';
import { useApi } from '@/shared/lib/ApiProvider';
import { pendingCount, startAutoFlush } from '@/shared/lib/offlineQueue';

export function SyncIndicator() {
  const { sessions } = useApi();
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  );

  useEffect(() => {
    let cancelled = false;
    void pendingCount().then((count) => {
      if (!cancelled) setPending(count);
    });

    const stop = startAutoFlush(() => sessions.get()?.accessToken ?? null, {
      onChange: (count) => {
        if (!cancelled) setPending(count);
      },
    });

    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    return () => {
      cancelled = true;
      stop();
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [sessions]);

  if (pending === 0 && online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-30 flex items-center justify-center gap-2 border-b border-border bg-surface-raised px-4 py-2 pt-safe text-xs text-text-muted"
    >
      {!online ? (
        <>
          <span aria-hidden="true">●</span>
          <span>
            Offline
            {pending > 0
              ? ` — ${pending} ${pending === 1 ? 'entry' : 'entries'} saved on this device`
              : ' — anything you log is saved on this device'}
          </span>
        </>
      ) : (
        <span>
          Syncing {pending} {pending === 1 ? 'entry' : 'entries'}…
        </span>
      )}
    </div>
  );
}
