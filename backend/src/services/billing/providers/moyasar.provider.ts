/**
 * Moyasar — STUB. Not implemented, not called, not wired into any route.
 *
 * It is the sensible default for a Saudi-based app when real payments are added:
 * transparent published pricing, no monthly fee, and local payment-method support
 * including Mada. Stripe's support for Saudi-registered merchants is not clearly
 * established, so it should not be assumed without checking first.
 *
 * Every method throws rather than returning a plausible-looking value, so there is
 * no way to half-integrate payments by accident.
 */
import type { SubscriptionStatus } from '@app/shared-types';
import type { CheckoutSession, PaymentProvider } from './payment-provider.interface.js';

const NOT_IMPLEMENTED = 'Moyasar is not integrated. See docs/REMAINING-WORK.md.';

export function createMoyasarProvider(): PaymentProvider {
  return {
    name: 'moyasar',
    enabled: false,
    async createCheckoutSession(): Promise<CheckoutSession> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async getStatus(): Promise<SubscriptionStatus> {
      throw new Error(NOT_IMPLEMENTED);
    },
    async handleWebhook(): Promise<void> {
      throw new Error(NOT_IMPLEMENTED);
    },
  };
}
