/**
 * Step 1: the value proposition.
 *
 * Carries the escape hatch for returning users ("I already have an account"),
 * which is what stops someone who already signed up being walked through four
 * questions before being allowed to log in.
 */
import { useNavigate } from 'react-router-dom';
import { Button, Screen } from '@/shared/components/Field';

export function OnboardingWelcome() {
  const navigate = useNavigate();

  return (
    <Screen>
      <div className="flex min-h-dvh flex-col justify-between py-8">
        <div className="flex flex-1 flex-col justify-center gap-6">
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold text-text">Train, eat, and see what changes</h1>
            <p className="text-base text-text-muted">
              Log your workouts and meals, record your weight and measurements, and get a straight
              answer on whether what you are doing is working.
            </p>
          </div>

          <ul className="flex flex-col gap-3 text-sm text-text-muted">
            <li className="flex gap-3">
              <span aria-hidden="true" className="text-accent">
                ▲
              </span>
              Build routines from a library of 800+ exercises
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="text-accent">
                ●
              </span>
              Log food by search, your own recipes, or a photo of your meal
            </li>
            <li className="flex gap-3">
              <span aria-hidden="true" className="text-accent">
                ◆
              </span>
              See weight change against intake, with a clear recommendation
            </li>
          </ul>
        </div>

        {/* Primary action bottom-anchored, in the thumb zone. */}
        <div className="flex flex-col gap-3">
          <Button onClick={() => navigate('/onboarding/goals')}>Get started</Button>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="min-h-touch text-sm font-medium text-accent active:opacity-70"
          >
            I already have an account? Log in
          </button>
          <p className="px-2 text-center text-xs text-text-muted">
            No account needed yet — we ask a few questions first.
          </p>
        </div>
      </div>
    </Screen>
  );
}
