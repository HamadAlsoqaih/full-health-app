/**
 * Billing. Returns a fixed free plan for every user.
 *
 * No payment gateway is integrated and the Premium card in Settings takes no
 * money, so this does not read the database: a subscriptions row would be
 * bookkeeping for a subscription that cannot exist. The row and its idempotent
 * creator exist behind `subscriptionRepository.ensureFree` for when that changes.
 */
import type { SubscriptionStatus } from '@app/shared-types';

const FREE: SubscriptionStatus = { plan: 'free', isPremium: false };

export function getBillingStatus(): SubscriptionStatus {
  return FREE;
}

/** What the Premium card advertises. Copy only — nothing here is purchasable. */
export const PREMIUM_TEASER = {
  title: 'Full Health Premium',
  subtitle: 'Not available yet',
  features: [
    'Unlimited AI meal photo scans',
    'Deeper body-composition analysis and longer history',
    'Custom macro targets per day of the week',
    'Export your data',
  ],
} as const;
