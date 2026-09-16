/**
 * Payment provider contract — the same swappable-provider pattern as the AI layer
 * (spec rule 8), applied a second time.
 *
 * Nothing implements this functionally yet. It exists so a real gateway can be
 * dropped in without reshaping the billing service or the client, and so the
 * Premium placeholder in Settings has somewhere to grow into.
 */
import type { SubscriptionStatus } from '@app/shared-types';

export interface CheckoutSession {
  /** Where to send the browser to complete payment. */
  url: string;
  reference: string;
}

export interface PaymentProvider {
  readonly name: string;
  /** False for every provider until one is genuinely wired up. */
  readonly enabled: boolean;
  createCheckoutSession(userId: string, plan: 'premium'): Promise<CheckoutSession>;
  getStatus(userId: string): Promise<SubscriptionStatus>;
  /** Verifies and applies a provider callback. */
  handleWebhook(signature: string, rawBody: Buffer): Promise<void>;
}
