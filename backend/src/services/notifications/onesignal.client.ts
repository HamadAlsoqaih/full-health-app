/**
 * OneSignal web-push client.
 *
 * Web push is what a PWA uses, and it is what this app sends. No health data ever
 * goes into a payload: a notification is rendered by the OS, may sit on a lock
 * screen, and is visible to anyone holding the phone.
 *
 * With no credentials configured this is disabled and every call is a no-op, which
 * is the state in CI and on a fresh clone.
 */
import type { NotificationEvent } from '@app/shared-types';
import { config } from '../../config/index.js';
import { logger } from '../../logger.js';
import type { NotificationsPort } from '../../ports.js';

const ENDPOINT = 'https://api.onesignal.com/notifications';

/** Copy per event. Deliberately vague about the body: see the note above. */
const MESSAGES: Record<NotificationEvent, { title: string; body: string }> = {
  'evaluation-ready': {
    title: 'Your check-in is ready',
    body: 'Your latest body-composition summary is ready to view.',
  },
  'log-reminder': {
    title: 'Log your meals',
    body: 'Keeping your food log current keeps your trend accurate.',
  },
  'workout-reminder': {
    title: 'Training day',
    body: 'You have a routine scheduled.',
  },
};

export function createOneSignalClient(
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): NotificationsPort {
  const enabled = config.notifications.enabled;

  return {
    enabled,
    async notify(event, playerIds, payload) {
      if (!enabled || playerIds.length === 0) return;

      const message = MESSAGES[event];
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Key ${config.notifications.apiKey ?? ''}`,
          },
          body: JSON.stringify({
            app_id: config.notifications.appId,
            include_player_ids: playerIds,
            headings: { en: message.title },
            contents: { en: message.body },
            // Routing hints only. Never health data.
            data: { event, ...payload },
          }),
          signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
          // Logged, never thrown: a failed notification must not fail the request
          // that triggered it.
          logger.warn({ event, status: response.status }, 'push notification was not accepted');
        }
      } catch (error) {
        logger.warn({ err: error, event }, 'push notification failed to send');
      }
    },
  };
}

/** Used when no credentials are configured, and by tests. */
export function createDisabledNotifications(): NotificationsPort {
  return {
    enabled: false,
    async notify() {
      /* no-op */
    },
  };
}
