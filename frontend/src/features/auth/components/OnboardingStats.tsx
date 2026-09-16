/**
 * Step 3: starting stats.
 *
 * Weight is required and everything else is optional, because weight is the one
 * measurement the trend engine cannot work without. Asking for seven tape
 * measurements as a precondition would lose people here.
 *
 * Entry is in the user's chosen units but stored in metric — conversion happens
 * here, at the UI edge, and nowhere else. A kg column holding pounds is
 * unrecoverable once it has happened.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TapeMeasurementsCm, UnitSystem } from '@app/shared-types';
import { Button, NumberField, Screen, SelectField } from '@/shared/components/Field';
import { lbToKg, inToCm } from '@/shared/lib/units';
import { useOnboarding } from '../state/OnboardingProvider';

const TAPE_FIELDS: Array<{ key: keyof TapeMeasurementsCm; label: string }> = [
  { key: 'neck', label: 'Neck' },
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'thigh', label: 'Thigh' },
  { key: 'arm', label: 'Arm' },
  { key: 'calf', label: 'Calf' },
];

export function OnboardingStats() {
  const navigate = useNavigate();
  const { draft, setStats } = useOnboarding();

  const [units, setUnits] = useState<UnitSystem>('metric');
  const [weight, setWeight] = useState(draft.stats?.weightKg?.toString() ?? '');
  const [bodyFat, setBodyFat] = useState(draft.stats?.bodyFatPct?.toString() ?? '');
  const [tape, setTape] = useState<Record<string, string>>({});
  const [showTape, setShowTape] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = () => {
    const next: Record<string, string> = {};

    const rawWeight = Number.parseFloat(weight);
    if (!Number.isFinite(rawWeight) || rawWeight <= 0) {
      next.weight = 'Enter your current weight.';
    }
    const weightKg = units === 'metric' ? rawWeight : lbToKg(rawWeight);
    if (Number.isFinite(weightKg) && (weightKg < 20 || weightKg > 500)) {
      next.weight = 'That does not look like a plausible weight.';
    }

    let bodyFatPct: number | undefined;
    if (bodyFat.trim()) {
      const parsed = Number.parseFloat(bodyFat);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 75) {
        next.bodyFat = 'Enter a percentage between 0 and 75, or leave it blank.';
      } else {
        bodyFatPct = parsed;
      }
    }

    const tapeCm: TapeMeasurementsCm = {};
    for (const field of TAPE_FIELDS) {
      const raw = tape[field.key]?.trim();
      if (!raw) continue;
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        next[field.key] = 'Enter a number, or leave it blank.';
        continue;
      }
      tapeCm[field.key] = units === 'metric' ? parsed : inToCm(parsed);
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setStats({
      weightKg: Math.round(weightKg * 100) / 100,
      ...(bodyFatPct !== undefined ? { bodyFatPct } : {}),
      ...(Object.keys(tapeCm).length > 0 ? { tapeCm } : {}),
    });
    navigate('/onboarding/dietary');
  };

  return (
    <Screen>
      <div className="flex min-h-dvh flex-col justify-between py-6">
        <div className="flex flex-col gap-6">
          <header className="flex flex-col gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
              Step 2 of 3
            </p>
            <h1 className="text-2xl font-semibold text-text">Where are you starting from?</h1>
            <p className="text-sm text-text-muted">
              Only your weight is needed. You can add the rest any time.
            </p>
          </header>

          <SelectField
            label="Units"
            value={units}
            onChange={(event) => setUnits(event.target.value as UnitSystem)}
            options={[
              { value: 'metric', label: 'Metric (kg, cm)' },
              { value: 'imperial', label: 'Imperial (lb, in)' },
            ]}
          />

          <NumberField
            label="Current weight"
            unit={units === 'metric' ? 'kg' : 'lb'}
            placeholder={units === 'metric' ? '88.4' : '195'}
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            {...(errors.weight ? { error: errors.weight } : {})}
          />

          <NumberField
            label="Body fat"
            optional
            unit="%"
            hint="From a scale, calipers or a scan — an estimate is fine."
            placeholder="18"
            value={bodyFat}
            onChange={(event) => setBodyFat(event.target.value)}
            {...(errors.bodyFat ? { error: errors.bodyFat } : {})}
          />

          {/* Collapsed by default: seven more inputs on first run is a wall. */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setShowTape((v) => !v)}
              aria-expanded={showTape}
              className="min-h-touch text-left text-sm font-medium text-accent active:opacity-70"
            >
              {showTape ? 'Hide tape measurements' : 'Add tape measurements (optional)'}
            </button>

            {showTape ? (
              <div className="flex flex-col gap-4">
                {TAPE_FIELDS.map((field) => (
                  <NumberField
                    key={field.key}
                    label={field.label}
                    optional
                    unit={units === 'metric' ? 'cm' : 'in'}
                    value={tape[field.key] ?? ''}
                    onChange={(event) =>
                      setTape((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    {...(errors[field.key] ? { error: errors[field.key] as string } : {})}
                  />
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-6">
          <Button onClick={submit}>Continue</Button>
        </div>
      </div>
    </Screen>
  );
}
