/**
 * The ONE place that decides where the user goes (spec §1).
 *
 * No feature screen re-checks auth or onboarding state. That rule matters because
 * the decision has six inputs — whether a session exists, whether the profile has
 * loaded, whether goals landed, whether the starting stats landed, whether
 * onboarding is complete, and which route was asked for — and duplicating it
 * anywhere guarantees the two copies eventually disagree.
 *
 * Resolution order, top down, first match wins:
 *
 *   0. Profile still loading with a session present  → splash
 *   1. No session                                    → onboarding, or login/signup if asked for
 *   2. Onboarding complete                           → the five tabs
 *   3. Goals not yet submitted                       → resume at goals
 *   4. Goals in, stats not yet submitted             → resume at stats
 *   5. Both submitted but not marked complete        → unreachable; falls through to the tabs
 *
 * States 3 and 4 are what make resume-after-close work. They read the
 * server-derived progress flags rather than trusting the local draft, because the
 * draft can be missing entirely — a user who signs up on their phone and reopens
 * on a laptop has no draft, and must still land on the right step.
 */
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useApi, useSession } from '@/shared/lib/ApiProvider';
import { useMe } from '@/features/auth/hooks/useAuth';
import { OnboardingProvider } from '@/features/auth/state/OnboardingProvider';
import { OnboardingWelcome } from '@/features/auth/components/OnboardingWelcome';
import { OnboardingGoals } from '@/features/auth/components/OnboardingGoals';
import { OnboardingStats } from '@/features/auth/components/OnboardingStats';
import { OnboardingDietaryPrefs } from '@/features/auth/components/OnboardingDietaryPrefs';
import { Signup } from '@/features/auth/components/Signup';
import { Login } from '@/features/auth/components/Login';
import { ResumeOnboarding } from '@/features/auth/components/ResumeOnboarding';
import { TabLayout } from './TabLayout';
import { OverviewDashboard } from '@/features/overview/components/OverviewDashboard';
import { TrainingTab } from '@/features/training/components/TrainingTab';
import { NutritionTab } from '@/features/nutrition/components/NutritionTab';
import { BodyCompositionTab } from '@/features/body-composition/components/BodyCompositionTab';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { Splash } from '@/shared/components/Splash';
import { ErrorState } from '@/shared/components/ErrorState';
import { ApiRequestError } from '@/shared/lib/apiClient';

export function AppRouter() {
  const { sessions } = useApi();

  // Subscribed, not merely read: clearing the session after a failed refresh has
  // to re-render this component, or the user is stranded on a signed-in screen.
  const hasSession = useSession() !== null;
  const me = useMe(hasSession);

  /**
   * Whether the last failure was an unrecoverable 401, reported by the API layer.
   *
   * The client clears the session the moment a refresh fails, so a component
   * cannot distinguish that from a deliberate sign-out by looking at the session
   * alone. Someone whose session lapsed is a returning user and belongs at login,
   * not back in the questionnaire.
   */
  const { sessionExpired, acknowledgeSessionExpiry } = useApi();

  // A profile request that 401s despite a stored session means the same thing.
  useEffect(() => {
    if (
      hasSession &&
      me.isError &&
      me.error instanceof ApiRequestError &&
      me.error.code === 'UNAUTHENTICATED'
    ) {
      sessions.set(null);
    }
  }, [hasSession, me.isError, me.error, sessions]);

  // Reset once signed in again, so a later sign-out is not misreported as expiry.
  useEffect(() => {
    if (hasSession && sessionExpired) acknowledgeSessionExpiry();
  }, [hasSession, sessionExpired, acknowledgeSessionExpiry]);

  // ---- 0. Waiting on the profile -----------------------------------------
  if (hasSession && me.isLoading) return <Splash />;

  // A real failure (offline, server down) is shown rather than silently treated
  // as "not onboarded", which would drop the user back into the questionnaire.
  if (
    hasSession &&
    me.isError &&
    !(me.error instanceof ApiRequestError && me.error.code === 'UNAUTHENTICATED')
  ) {
    return <ErrorState error={me.error} onRetry={() => void me.refetch()} />;
  }

  // ---- 1. No session ------------------------------------------------------
  if (!hasSession) {
    // A first-time visitor starts at the value proposition; someone whose session
    // just lapsed starts at login.
    const fallback = sessionExpired ? '/login' : '/onboarding/welcome';
    return (
      <OnboardingProvider>
        <Routes>
          <Route path="/onboarding/welcome" element={<OnboardingWelcome />} />
          <Route path="/onboarding/goals" element={<OnboardingGoals />} />
          <Route path="/onboarding/stats" element={<OnboardingStats />} />
          <Route path="/onboarding/dietary" element={<OnboardingDietaryPrefs />} />
          <Route path="/onboarding/signup" element={<Signup />} />
          <Route path="/login" element={<Login />} />
          <Route path="*" element={<Navigate to={fallback} replace />} />
        </Routes>
      </OnboardingProvider>
    );
  }

  const onboarding = me.data?.onboarding;

  // ---- 2. Fully onboarded -------------------------------------------------
  if (onboarding?.complete) {
    return (
      <Routes>
        <Route path="/app" element={<TabLayout />}>
          <Route index element={<Navigate to="/app/overview" replace />} />
          <Route path="overview" element={<OverviewDashboard />} />
          <Route path="training" element={<TrainingTab />} />
          <Route path="nutrition" element={<NutritionTab />} />
          <Route path="body" element={<BodyCompositionTab />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        {/* An onboarding or auth URL is stale for this user; send them home. */}
        <Route path="*" element={<Navigate to="/app/overview" replace />} />
      </Routes>
    );
  }

  // ---- 3, 4. Authenticated but mid-onboarding -----------------------------
  // ResumeOnboarding attempts the outstanding write from the persisted draft, so
  // the usual experience is a brief spinner rather than re-typing answers. Where
  // no draft survives, it renders the step's form instead.
  return (
    <OnboardingProvider>
      <ResumeOnboarding
        goalsSubmitted={onboarding?.goalsSubmitted ?? false}
        statsSubmitted={onboarding?.startingStatsSubmitted ?? false}
      />
    </OnboardingProvider>
  );
}
