/**
 * Provider stack, outermost first.
 *
 * Order matters: the error boundary must wrap everything so a render crash is
 * caught rather than showing a white screen; the API provider must sit above the
 * query client's consumers; and the router must be inside all of them.
 */
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiProvider } from '@/shared/lib/ApiProvider';
import { createQueryClient } from '@/shared/lib/queryClient';
import { ToastProvider } from '@/shared/components/Toast';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { AppRouter } from '@/routes/AppRouter';

export function App() {
  // Created once per mount, not per render: a new QueryClient would drop the
  // entire cache on any parent re-render.
  const queryClient = useMemo(() => createQueryClient(), []);

  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ApiProvider>
          <ToastProvider>
            <BrowserRouter>
              <AppRouter />
            </BrowserRouter>
          </ToastProvider>
        </ApiProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
