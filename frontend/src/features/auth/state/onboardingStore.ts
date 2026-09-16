/**
 * Onboarding answers, held client-side until signup succeeds.
 *
 * The spec says these live in client state only, because until the account exists
 * there is no user id to attach them to. It also says the app must resume at
 * whichever step was not yet submitted if it is closed mid-onboarding. Those two
 * requirements only reconcile one way: "client-side" means *not on the server*,
 * not *not on disk*. In-memory React state is gone the moment the app closes, so
 * the draft is mirrored to localStorage on every change.
 *
 * localStorage rather than sessionStorage, which dies on close — the exact case
 * being handled. And not IndexedDB, whose asynchronous read would make the router
 * flash the wrong screen on boot.
 *
 * `statsClientId` is minted when the stats are captured, NOT when they are
 * submitted. That is what makes the post-signup write replay-safe: if the app dies
 * mid-submit, the retry carries the same idempotency key and cannot create a
 * second measurement.
 *
 * The draft holds health data, so it is cleared on completion and on logout.
 */
import type { DietaryPreferences, Goals, TapeMeasurementsCm } from '@app/shared-types';

const DRAFT_KEY = 'fha.onboarding.draft.v1';
const DRAFT_VERSION = 1;

export interface StartingStats {
  weightKg: number;
  bodyFatPct?: number;
  tapeCm?: TapeMeasurementsCm;
}

export interface OnboardingDraft {
  v: number;
  goals?: Goals;
  dietaryPrefs?: DietaryPreferences;
  stats?: StartingStats;
  /** Minted at capture time so a retried submit is idempotent. */
  statsClientId?: string;
  /** Which post-signup writes have landed. Two, so resume has two states. */
  submitted: { goals: boolean; stats: boolean };
  updatedAt: string;
}

export const emptyDraft = (): OnboardingDraft => ({
  v: DRAFT_VERSION,
  submitted: { goals: false, stats: false },
  updatedAt: new Date().toISOString(),
});

/**
 * Reads the draft, tolerating every way storage can fail or lie.
 *
 * A private window, cleared site data or a blocked store can make this throw or
 * return nonsense. Returning null is always safe: the user re-enters answers,
 * which is a minor annoyance, whereas a crash on boot is not recoverable.
 */
export function loadDraft(): OnboardingDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
    // A draft from an older shape is discarded rather than migrated: it is a few
    // answers, and guessing at a stale shape risks submitting wrong health data.
    if (parsed.v !== DRAFT_VERSION) return null;

    return {
      v: DRAFT_VERSION,
      submitted: {
        goals: parsed.submitted?.goals === true,
        stats: parsed.submitted?.stats === true,
      },
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      ...(parsed.goals ? { goals: parsed.goals } : {}),
      ...(parsed.dietaryPrefs ? { dietaryPrefs: parsed.dietaryPrefs } : {}),
      ...(parsed.stats ? { stats: parsed.stats } : {}),
      ...(parsed.statsClientId ? { statsClientId: parsed.statsClientId } : {}),
    };
  } catch {
    return null;
  }
}

export function saveDraft(draft: OnboardingDraft): void {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ ...draft, updatedAt: new Date().toISOString() }),
    );
  } catch {
    // Unwritable storage means resume will not work, but onboarding still does.
  }
}

/** Called on completion and on logout: the draft holds health data. */
export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Nothing to do; an unwritable store had nothing in it either.
  }
}

/**
 * A client-minted idempotency key.
 *
 * crypto.randomUUID is unavailable on older Safari and on any non-secure origin,
 * so there is a fallback. It is not cryptographically strong, and does not need to
 * be: the value only has to be unique within one user's own key space.
 */
export function mintClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The onboarding steps, in order. */
export const ONBOARDING_STEPS = ['welcome', 'goals', 'stats', 'dietary', 'signup'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
