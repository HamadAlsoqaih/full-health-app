/**
 * Recording NotificationsPort. Asserting that the evaluation-ready notification
 * fires exactly once is the point — a double-send is the bug a naive
 * read-then-write reaper would introduce.
 */
import type { NotificationEvent } from '@app/shared-types';
import type { NotificationsPort } from '../../src/ports.js';

export interface SentNotification {
  event: NotificationEvent;
  playerIds: string[];
  payload?: Record<string, string>;
}

export interface FakeNotifications extends NotificationsPort {
  readonly sent: SentNotification[];
}

export function createFakeNotifications(): FakeNotifications {
  const sent: SentNotification[] = [];
  return {
    enabled: true,
    sent,
    async notify(event, playerIds, payload) {
      sent.push({ event, playerIds, ...(payload ? { payload } : {}) });
    },
  };
}
