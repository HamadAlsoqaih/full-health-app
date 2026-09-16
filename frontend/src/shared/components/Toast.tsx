/**
 * Transient messages.
 *
 * Positioned above the bottom navigation and inside the safe area, so a toast is
 * never hidden behind the tab bar or the iOS home indicator.
 *
 * The container is a polite live region: a toast confirming a save should be
 * announced, but not interrupt whatever a screen reader is already saying.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

interface ToastContextValue {
  show(message: string, tone?: Toast['tone']): void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TONE_CLASS: Record<Toast['tone'], string> = {
  info: 'bg-surface-raised text-text border-border',
  success: 'bg-surface-raised text-success border-success/40',
  error: 'bg-surface-raised text-danger border-danger/40',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{
          // Clears the tab bar and the home indicator.
          bottom: 'calc(var(--spacing-nav-h) + env(safe-area-inset-bottom, 0px) + 1rem)',
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`w-full max-w-content-max rounded-lg border px-4 py-3 text-sm shadow-card ${TONE_CLASS[toast.tone]}`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  // Falls back to a no-op rather than throwing: a missing provider should not
  // crash a screen over a transient message.
  return context ?? { show: () => undefined };
}
