/**
 * Step 2: goals.
 *
 * Held client-side only — there is no user id to attach it to yet. Target
 * calories are optional: most people do not know the number, and the trend engine
 * derives its own estimate from logged intake anyway.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { GoalType } from '@app/shared-types';
import { Button, NumberField, Screen } from '@/shared/components/Field';
import { useOnboarding } from '../state/OnboardingProvider';

const GOALS: Array<{ value: GoalType; title: string; description: string }> = [
  { value: 'cut', title: 'Lose fat', description: 'Eat below maintenance and keep muscle' },
  { value: 'bulk', title: 'Build muscle', description: 'Eat above maintenance and gain slowly' },
  { value: 'maintain', title: 'Maintain', description: 'Hold weight and train consistently' },
];

export function OnboardingGoals() {
  const navigate = useNavigate();
  const { draft, setGoals } = useOnboarding();

  const [goal, setGoal] = useState<GoalType>(draft.goals?.goal ?? 'cut');
  const [targetCalories, setTargetCalories] = useState(
    draft.goals?.targetCalories?.toString() ?? '',
  );
  const [error, setError] = useState<string>();

  const submit = () => {
    const parsed = targetCalories.trim() ? Number.parseInt(targetCalories, 10) : undefined;
    if (parsed !== undefined && (!Number.isFinite(parsed) || parsed < 800 || parsed > 10_000)) {
      setError('Enter a daily target between 800 and 10000, or leave it blank.');
      return;
    }

    setGoals({ goal, ...(parsed !== undefined ? { targetCalories: parsed } : {}) });
    navigate('/onboarding/stats');
  };

  return (
    <Screen>
      <div className="flex min-h-dvh flex-col justify-between py-6">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Step 1 of 3
            </p>
            <h1 className="text-2xl font-semibold text-text">What are you working towards?</h1>
          </header>

          <fieldset className="flex flex-col gap-3">
            <legend className="sr-only">Goal</legend>
            {GOALS.map((option) => {
              const selected = goal === option.value;
              return (
                <label
                  key={option.value}
                  className={[
                    'flex min-h-touch cursor-pointer items-start gap-3 rounded-lg border p-4',
                    // Selection is shown by border, background AND a filled radio,
                    // never by colour alone.
                    selected ? 'border-accent bg-accent-soft' : 'border-border bg-surface-raised',
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="goal"
                    value={option.value}
                    checked={selected}
                    onChange={() => setGoal(option.value)}
                    className="mt-0.5 size-5 accent-accent"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-text">{option.title}</span>
                    <span className="text-sm text-text-muted">{option.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <NumberField
            label="Daily calorie target"
            optional
            unit="kcal"
            hint="Leave blank and we will estimate it from your logs."
            placeholder="2200"
            value={targetCalories}
            onChange={(event) => {
              setTargetCalories(event.target.value);
              setError(undefined);
            }}
            {...(error ? { error } : {})}
          />
        </div>

        <div className="flex flex-col gap-2 pt-6">
          <Button onClick={submit}>Continue</Button>
        </div>
      </div>
    </Screen>
  );
}
