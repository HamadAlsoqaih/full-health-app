/**
 * Billing status. Always the free plan — no gateway is integrated and the Premium
 * card in Settings takes no money.
 */
import type { RequestHandler } from 'express';
import { getBillingStatus, PREMIUM_TEASER } from '../services/billing/billing.service.js';

export function makeBillingController() {
  const status: RequestHandler = (_req, res) => {
    res.json(getBillingStatus());
  };

  /** Copy for the upsell card. Nothing here is purchasable. */
  const premiumTeaser: RequestHandler = (_req, res) => {
    res.json(PREMIUM_TEASER);
  };

  return { status, premiumTeaser };
}
