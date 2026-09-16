/**
 * Notification dispatch.
 *
 * Looks up the user's registered devices and respects their preferences before
 * sending. A user who turned an event off must not receive it, and a user with no
 * registered device is not an error.
 */
import type { NotificationEvent, UserPreferences } from '@app/shared-types';
import type { NotificationsPort } from '../../ports.js';
import type { Repositories } from '../../repositories/index.js';
import { logger } from '../../logger.js';

function wantsEvent(preferences: unknown, event: NotificationEvent): boolean {
  const prefs = preferences as Partial<UserPreferences> | null | undefined;
  const notifications = prefs?.notifications;
  if (!notifications) return true;

  switch (event) {
    case 'evaluation-ready':
      return notifications.evaluationReadyEnabled !== false;
    case 'log-reminder':
    case 'workout-reminder':
      return notifications.remindersEnabled !== false;
    default:
      return true;
  }
}

export async function notify(
  repos: Repositories,
  port: NotificationsPort,
  event: NotificationEvent,
  userId: string,
  payload?: Record<string, string>,
): Promise<void> {
  if (!port.enabled) return;

  try {
    const user = await repos.users.findById(userId);
    if (!user || !wantsEvent(user.preferences, event)) return;

    const playerIds = await repos.pushSubscriptions.listPlayerIds(userId);
    if (playerIds.length === 0) return;

    await port.notify(event, playerIds, payload);
  } catch (error) {
    // Swallowed by design. This is called from a background job and from request
    // paths that have already succeeded; a notification failure must not surface
    // as a failed user action.
    logger.warn({ err: error, event }, 'could not dispatch notification');
  }
}

export async function registerDevice(
  repos: Repositories,
  userId: string,
  playerId: string,
): Promise<void> {
  await repos.pushSubscriptions.upsert(userId, playerId);
}
