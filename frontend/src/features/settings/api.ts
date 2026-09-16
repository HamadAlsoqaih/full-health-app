/** Settings endpoints: billing status and push registration. */
import type { SubscriptionStatus } from '@app/shared-types';
import type { ApiClient } from '@/shared/lib/apiClient';

export interface PremiumTeaser {
  title: string;
  subtitle: string;
  features: string[];
}

export const settingsApi = (client: ApiClient) => ({
  /** Always { plan: 'free', isPremium: false } while billing is a placeholder. */
  billingStatus: () => client.get<SubscriptionStatus>('/api/billing/status'),
  premiumTeaser: () => client.get<PremiumTeaser>('/api/billing/premium-teaser'),
  registerPush: (oneSignalPlayerId: string) =>
    client.post<void>('/api/notifications/subscribe', { oneSignalPlayerId }),
});
