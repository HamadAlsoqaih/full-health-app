/**
 * React context over the onboarding draft.
 *
 * Every mutation writes through to localStorage synchronously, so a close at any
 * point leaves a resumable draft. Components never touch storage directly.
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DietaryPreferences, Goals } from '@app/shared-types';
import {
  clearDraft,
  emptyDraft,
  loadDraft,
  mintClientId,
  saveDraft,
  type OnboardingDraft,
  type StartingStats,
} from './onboardingStore';

interface OnboardingContextValue {
  draft: OnboardingDraft;
  setGoals(goals: Goals): void;
  setDietaryPrefs(prefs: DietaryPreferences): void;
  /** Mints and stores the idempotency key alongside the stats. */
  setStats(stats: StartingStats): void;
  markSubmitted(which: 'goals' | 'stats'): void;
  reset(): void;
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  // Read once, synchronously, on first render: the router decides the initial
  // route from this and must not flash the wrong screen first.
  const [draft, setDraft] = useState<OnboardingDraft>(() => loadDraft() ?? emptyDraft());

  // Kept in a ref so the callbacks below stay stable and do not re-run effects.
  const latest = useRef(draft);
  latest.current = draft;

  const update = useCallback((patch: Partial<OnboardingDraft>) => {
    const next: OnboardingDraft = { ...latest.current, ...patch };
    latest.current = next;
    setDraft(next);
    saveDraft(next);
  }, []);

  const value = useMemo<OnboardingContextValue>(
    () => ({
      draft,
      setGoals: (goals) => update({ goals }),
      setDietaryPrefs: (dietaryPrefs) => update({ dietaryPrefs }),
      setStats: (stats) =>
        update({
          stats,
          // Reuses an existing key if the user edits their stats before signing
          // up, so an edit cannot produce two measurements.
          statsClientId: latest.current.statsClientId ?? mintClientId(),
        }),
      markSubmitted: (which) =>
        update({ submitted: { ...latest.current.submitted, [which]: true } }),
      reset: () => {
        clearDraft();
        const fresh = emptyDraft();
        latest.current = fresh;
        setDraft(fresh);
      },
    }),
    [draft, update],
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) throw new Error('useOnboarding must be used inside OnboardingProvider');
  return context;
}
