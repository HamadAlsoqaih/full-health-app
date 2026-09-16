/**
 * Resume for a user who is signed in but did not finish onboarding.
 *
 * The situation this exists for: the account was created, one of the two
 * post-signup writes landed, and the app closed. On next open there is a session
 * but onboarding is incomplete, and simply showing the questionnaire again would
 * make the user retype answers they already gave.
 *
 * So: if the persisted draft still holds the outstanding answer, it is submitted
 * automatically and the user sees a brief spinner. If it does not — a different
 * device, or cleared site data — the corresponding step's form is rendered so they
 * can supply it. Either way, exactly the missing piece is asked for.
 *
 * The server's progress flags decide what is outstanding, not the draft, because
 * the draft can be absent while the server knows perfectly well what landed.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { todayIso } from '@/shared/lib/dates';
import { ErrorState } from '@/shared/components/ErrorState';
import { Splash } from '@/shared/components/Splash';
import { bodyCompositionApi } from '@/features/body-composition/api';
import { useAuthActions } from '../hooks/useAuth';
import { useOnboarding } from '../state/OnboardingProvider';
import { mintClientId } from '../state/onboardingStore';
import { OnboardingGoals } from './OnboardingGoals';
import { OnboardingStats } from './OnboardingStats';

interface ResumeOnboardingProps {
  goalsSubmitted: boolean;
  statsSubmitted: boolean;
}

export function ResumeOnboarding({ goalsSubmitted, statsSubmitted }: ResumeOnboardingProps) {
  const queryClient = useQueryClient();
  const { client } = useApi();
  const { submitGoals } = useAuthActions();
  const { draft, markSubmitted } = useOnboarding();

  const [error, setError] = useState<unknown>();
  // Guards against a second attempt if the effect re-runs before the profile
  // refetch lands, which would otherwise double-submit.
  const attempted = useRef(false);

  const canResumeGoals = !goalsSubmitted && Boolean(draft.goals);
  const canResumeStats = goalsSubmitted && !statsSubmitted && Boolean(draft.stats);

  useEffect(() => {
    if (attempted.current) return;
    if (!canResumeGoals && !canResumeStats) return;

    attempted.current = true;

    void (async () => {
      try {
        if (canResumeGoals && draft.goals) {
          await submitGoals.mutateAsync({
            ...draft.goals,
            ...(draft.dietaryPrefs ? { dietaryPrefs: draft.dietaryPrefs } : {}),
          });
          markSubmitted('goals');
        }

        if (canResumeStats && draft.stats) {
          // The id was minted when the stats were captured, so this retry cannot
          // create a second measurement even if an earlier attempt half-succeeded.
          await bodyCompositionApi(client).createEntry({
            clientId: draft.statsClientId ?? mintClientId(),
            date: todayIso(),
            weightKg: draft.stats.weightKg,
            ...(draft.stats.bodyFatPct !== undefined ? { bodyFatPct: draft.stats.bodyFatPct } : {}),
            ...(draft.stats.tapeCm ? { tapeCm: draft.stats.tapeCm } : {}),
          });
          markSubmitted('stats');
        }

        // The router re-reads progress from this and moves the user on.
        await queryClient.invalidateQueries({ queryKey: queryKeys.me });
      } catch (caught) {
        // Reset so the user can retry rather than being stuck on a spinner.
        attempted.current = false;
        setError(caught);
      }
    })();
  }, [
    canResumeGoals,
    canResumeStats,
    draft.goals,
    draft.stats,
    draft.dietaryPrefs,
    draft.statsClientId,
    submitGoals,
    markSubmitted,
    client,
    queryClient,
  ]);

  if (error) {
    return (
      <ErrorState
        error={error}
        title="Could not finish setting up"
        onRetry={() => {
          setError(undefined);
          attempted.current = false;
        }}
      />
    );
  }

  // Auto-submitting: a spinner, not a form.
  if (canResumeGoals || canResumeStats) return <Splash />;

  // Nothing to resubmit, so ask for the missing piece.
  if (!goalsSubmitted) return <OnboardingGoals />;
  return <OnboardingStats />;
}
