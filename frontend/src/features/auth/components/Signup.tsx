/**
 * Step 5: account creation — the LAST onboarding step, not a gate before it.
 *
 * By this point the user has answered three sets of questions, so the ask is
 * "save what you have just done" rather than "prove yourself before we start".
 *
 * On success the held answers are submitted immediately, in order: goals, then the
 * starting stats as the user's first body-composition entry. Both are marked in
 * the draft as they land, so if the app dies between them the router resumes at
 * whichever one is still outstanding rather than redoing both.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '@/shared/lib/apiClient';
import { useApi } from '@/shared/lib/ApiProvider';
import { queryKeys } from '@/shared/lib/queryClient';
import { Button, Screen, TextField } from '@/shared/components/Field';
import { bodyCompositionApi } from '@/features/body-composition/api';
import { useAuthActions } from '../hooks/useAuth';
import { useOnboarding } from '../state/OnboardingProvider';
import { mintClientId } from '../state/onboardingStore';

export function Signup() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { client } = useApi();
  const { register, submitGoals } = useAuthActions();
  const { draft, markSubmitted, reset } = useOnboarding();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  /**
   * Submits whatever is still outstanding.
   *
   * Written to be safely re-runnable: each write is skipped if already marked, and
   * the stats write reuses the client id minted at capture time, so even a retry
   * that the marking missed cannot create a second measurement.
   */
  const submitHeldAnswers = async () => {
    if (draft.goals && !draft.submitted.goals) {
      await submitGoals.mutateAsync({
        ...draft.goals,
        ...(draft.dietaryPrefs ? { dietaryPrefs: draft.dietaryPrefs } : {}),
      });
      markSubmitted('goals');
    }

    if (draft.stats && !draft.submitted.stats) {
      await bodyCompositionApi(client).createEntry({
        clientId: draft.statsClientId ?? mintClientId(),
        date: new Date().toISOString().slice(0, 10),
        weightKg: draft.stats.weightKg,
        ...(draft.stats.bodyFatPct !== undefined ? { bodyFatPct: draft.stats.bodyFatPct } : {}),
        ...(draft.stats.tapeCm ? { tapeCm: draft.stats.tapeCm } : {}),
      });
      markSubmitted('stats');
    }

    await queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };

  const submit = async () => {
    setError(undefined);
    setBusy(true);
    try {
      await register.mutateAsync({ email: email.trim(), password });
      await submitHeldAnswers();
      // Step 6: the draft held health data and is no longer needed.
      reset();
      navigate('/app/overview', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(
          caught.code === 'CONFLICT'
            ? 'An account with that email already exists. Try logging in instead.'
            : caught.message,
        );
      } else {
        setError('Could not create your account. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  // Nothing to save means the user reached this screen directly; send them back
  // rather than creating an account with no answers attached.
  useEffect(() => {
    if (!draft.goals && !draft.stats) navigate('/onboarding/welcome', { replace: true });
  }, [draft.goals, draft.stats, navigate]);

  return (
    <Screen>
      <form
        className="flex min-h-dvh flex-col justify-between py-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <h1 className="text-2xl font-semibold text-text">Save your setup</h1>
            <p className="text-sm text-text-muted">
              Create an account so your logs are kept and synced across devices.
            </p>
          </header>

          <TextField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="next"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            enterKeyHint="done"
            hint="At least 8 characters."
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 pt-6">
          <Button type="submit" loading={busy} disabled={!email.trim() || password.length < 8}>
            Create account
          </Button>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="min-h-touch text-sm font-medium text-accent active:opacity-70"
          >
            I already have an account
          </button>
          <p className="px-2 text-center text-xs text-text-muted">
            By continuing you agree to the Terms of Service and Privacy Policy.
          </p>
        </div>
      </form>
    </Screen>
  );
}
