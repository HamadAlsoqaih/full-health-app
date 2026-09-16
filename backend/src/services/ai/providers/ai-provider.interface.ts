/**
 * Re-exported so the provider implementations in this directory import their
 * contract from beside them rather than reaching up into ports.ts. The interface
 * itself lives with the other ports.
 *
 * Both this and payment-provider.interface.ts follow the same swappable-provider
 * pattern (spec rule 8).
 */
export type { AiProvider, PhotoEstimate } from '../../../ports.js';
