/**
 * Step 4: dietary preferences. Fully optional and explicitly skippable.
 *
 * "Skip" is a first-class action rather than a greyed-out afterthought, and the
 * skip is recorded (`skipped: true`) rather than just leaving the field empty —
 * so the app knows the question was answered with "none of these" instead of
 * never having been asked.
 *
 * These ride inside the goals payload, because there is no separate endpoint for
 * them, which is also why there are exactly two post-signup writes.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Screen, TextField } from '@/shared/components/Field';
import { useOnboarding } from '../state/OnboardingProvider';

const COMMON_PREFERENCES = [
  'Halal',
  'Vegetarian',
  'Vegan',
  'Pescatarian',
  'Dairy-free',
  'Gluten-free',
  'Low carb',
  'High protein',
];

export function OnboardingDietaryPrefs() {
  const navigate = useNavigate();
  const { draft, setDietaryPrefs } = useOnboarding();

  const [selected, setSelected] = useState<string[]>(draft.dietaryPrefs?.preferences ?? []);
  const [allergies, setAllergies] = useState((draft.dietaryPrefs?.allergies ?? []).join(', '));

  const toggle = (preference: string) => {
    setSelected((current) =>
      current.includes(preference)
        ? current.filter((p) => p !== preference)
        : [...current, preference],
    );
  };

  const finish = (skipped: boolean) => {
    const parsedAllergies = allergies
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);

    setDietaryPrefs({
      preferences: skipped ? [] : selected,
      ...(parsedAllergies.length > 0 && !skipped ? { allergies: parsedAllergies } : {}),
      skipped,
    });
    navigate('/onboarding/signup');
  };

  return (
    <Screen>
      <div className="flex min-h-dvh flex-col justify-between py-6">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Step 3 of 3
            </p>
            <h1 className="text-2xl font-semibold text-text">Anything we should know?</h1>
            <p className="text-sm text-text-muted">
              Entirely optional. It only shapes suggestions — nothing is hidden from you.
            </p>
          </header>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-sm font-medium text-text">Preferences</legend>
            <div className="flex flex-wrap gap-2">
              {COMMON_PREFERENCES.map((preference) => {
                const isOn = selected.includes(preference);
                return (
                  <button
                    key={preference}
                    type="button"
                    onClick={() => toggle(preference)}
                    aria-pressed={isOn}
                    className={[
                      'min-h-touch rounded-full border px-4 text-sm font-medium',
                      'active:opacity-70',
                      isOn
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border bg-surface-raised text-text-muted',
                    ].join(' ')}
                  >
                    {/* A check mark, so selection is not conveyed by colour alone. */}
                    {isOn ? '✓ ' : ''}
                    {preference}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <TextField
            label="Allergies"
            optional
            hint="Comma separated, for example: peanuts, shellfish"
            placeholder="peanuts, shellfish"
            autoCapitalize="none"
            value={allergies}
            onChange={(event) => setAllergies(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-3 pt-6">
          <Button onClick={() => finish(false)}>Continue</Button>
          {/* Skip is a real, equally reachable action. */}
          <Button variant="ghost" onClick={() => finish(true)}>
            Skip this step
          </Button>
        </div>
      </div>
    </Screen>
  );
}
