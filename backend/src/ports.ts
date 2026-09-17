/**
 * The dependency seam.
 *
 * Every external system the API talks to — Supabase, the AI provider, the food
 * databases, OneSignal — is reached through one of these interfaces, and the whole
 * set is handed to `createApp()` in one object. Tests build the same object with
 * hand-written in-memory fakes.
 *
 * Why interfaces and hand-written fakes rather than `vi.mock('@supabase/supabase-js')`:
 * mocking the client means re-implementing its fluent builder
 * (`.from().select().eq().single()`) in every test file, and such a mock cannot hold
 * state across requests. The offline-sync test fundamentally needs the second POST to
 * see the row the first POST created. A narrow, domain-shaped port with an
 * array-backed fake gives that for free.
 *
 * `clock` and `uuid` are injected for the same reason: trend arithmetic and
 * idempotency both need determinism.
 */
import type {
  BodyCompEvaluation,
  ComputedTrend,
  FoodItem,
  NotificationEvent,
  ScanQuestion,
} from '@app/shared-types';
import type { Repositories, RepositoryContext } from './repositories/index.js';

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/** The identity the middleware attaches to a request. */
export interface AuthenticatedUser {
  id: string;
  email: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt: number;
}

export interface AuthPort {
  register(
    email: string,
    password: string,
  ): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }>;
  login(email: string, password: string): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }>;
  logout(accessToken: string): Promise<void>;
  refresh(refreshToken: string): Promise<{ user: AuthenticatedUser; tokens: AuthTokens }>;
  /** Resolves a bearer token to a user, or null when it is invalid or expired. */
  getUserFromToken(accessToken: string): Promise<AuthenticatedUser | null>;
}

// ---------------------------------------------------------------------------
// Database handle
// ---------------------------------------------------------------------------

/**
 * A per-request database handle.
 *
 * This is deliberately opaque. In production it is a Supabase client built from the
 * anon key with the caller's JWT attached, so row-level security applies to every
 * query. Because the handle is per request, repositories must be constructed per
 * request too — which is why `AppDeps.repositories` is a factory rather than a set
 * of singletons.
 */
export type DatabaseHandle = unknown;

export type RepositoryFactory = (context: RepositoryContext) => Repositories;

// ---------------------------------------------------------------------------
// AI
// ---------------------------------------------------------------------------

export interface PhotoEstimate {
  item: FoodItem;
  confidence: 'low' | 'medium';
  detectedItems: string[];
  /**
   * What the model could not tell from the photo. Empty is normal and means the
   * flow is the plain single-shot one.
   */
  questions: ScanQuestion[];
}

/** The answers, ready to be put back to the model with the same photo. */
export interface PhotoRefinement {
  previous: PhotoEstimate;
  /** Question text paired with the chosen option, since that is what the model reads. */
  answers: Array<{ question: string; answer: string }>;
  note?: string;
}

/**
 * Swappable AI provider (spec rule 8). Three implementations exist: gemini, groq
 * and a deterministic stub used whenever no key is configured.
 */
export interface AiProvider {
  readonly name: 'gemini' | 'groq' | 'stub';
  /** True when this provider can actually analyse an image. */
  readonly supportsVision: boolean;
  /**
   * Estimates the macros of a meal from a photograph. The image is held in memory
   * only for the duration of this call and is never persisted.
   */
  estimateFromPhoto(image: Buffer, mimeType: string): Promise<PhotoEstimate>;
  /**
   * Revises an estimate given the same photo and the user's answers.
   *
   * The image is passed again deliberately. Telling the model "8 pieces" only
   * helps if it can look at the bucket while recalculating, and a second look is
   * its only chance to correct something the first pass misread. Providers
   * without vision throw.
   */
  refineFromAnswers(
    image: Buffer,
    mimeType: string,
    refinement: PhotoRefinement,
  ): Promise<PhotoEstimate>;
  /**
   * Rephrases an already-computed trend in plain language. It must not alter the
   * numbers: all body-composition arithmetic is deterministic (spec rule 4).
   */
  phraseTrend(trend: ComputedTrend): Promise<string>;
}

// ---------------------------------------------------------------------------
// Food databases
// ---------------------------------------------------------------------------

export interface FoodDatabasePort {
  readonly source: 'usda' | 'open-food-facts';
  readonly enabled: boolean;
  search(query: string, signal?: AbortSignal): Promise<FoodItem[]>;
  getItem(externalId: string, signal?: AbortSignal): Promise<FoodItem | null>;
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export interface NotificationsPort {
  readonly enabled: boolean;
  /**
   * Fire-and-forget by design: a failed notification must never fail the request
   * that triggered it, nor block it.
   */
  notify(
    event: NotificationEvent,
    playerIds: string[],
    payload?: Record<string, string>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Background work
// ---------------------------------------------------------------------------

/**
 * Runs the AI evaluation for a saved measurement.
 *
 * There is no queue and no Redis: one job type does not justify either. The
 * implementation is an ordinary async function, started without being awaited and
 * wrapped so it always writes a terminal state. An escaping rejection would
 * otherwise take the process down through `unhandledRejection`.
 */
export interface EvaluationRunnerPort {
  /** Starts the evaluation. Returns immediately; does not throw. */
  start(evaluationId: string, userId: string): void;
  /** Used by the reaper to re-run an evaluation left stale by a crash or restart. */
  run(evaluationId: string, userId: string): Promise<BodyCompEvaluation>;
}

// ---------------------------------------------------------------------------
// The whole set
// ---------------------------------------------------------------------------

export interface AppDeps {
  auth: AuthPort;
  /** Per-request, because the database handle carries the caller's JWT. */
  repositories: RepositoryFactory;
  ai: AiProvider;
  foodDatabases: FoodDatabasePort[];
  notifications: NotificationsPort;
  /** Injected for determinism in tests. */
  clock: () => Date;
  uuid: () => string;
}
