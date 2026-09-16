/**
 * Boot screen, shown while the session is being resolved.
 *
 * Deliberately minimal and unbranded-but-calm: it exists to avoid a flash of the
 * wrong screen, and it is on screen for a few hundred milliseconds. On a cold
 * start against a sleeping free-tier backend it can be longer, which is why it
 * says something rather than showing a bare spinner.
 */
export function Splash() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg px-6"
    >
      <div
        aria-hidden="true"
        className="size-10 animate-pulse rounded-full border-2 border-accent"
      />
      <p className="text-sm text-text-muted">Loading your account…</p>
    </div>
  );
}
