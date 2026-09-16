import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { App } from './App';
import { config } from './shared/lib/config';
import './shared/theme/index.css';

// Initialised before render, so a crash during the first paint is still captured.
// The browser DSN is public by design; with none configured this is a no-op.
if (config.sentry.enabled) {
  Sentry.init({
    dsn: config.sentry.dsn,
    // Health data must not be shipped to a third-party error tracker.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) delete event.request.data;
      return event;
    },
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(<App />);
