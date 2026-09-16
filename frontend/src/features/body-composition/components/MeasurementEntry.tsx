/**
 * Records a weigh-in.
 *
 * Weight is the only required field, entered in the user's units and converted to
 * metric here at the edge. Works offline.
 */
import { useState } from 'react';
import type { TapeMeasurementsCm, UnitSystem } from '@app/shared-types';
import { Button, NumberField } from '@/shared/components/Field';
import { useToast } from '@/shared/components/Toast';
import { inToCm, lbToKg } from '@/shared/lib/units';
import { useRecordMeasurement } from '../hooks/useBodyComp';

const TAPE_FIELDS: Array<{ key: keyof TapeMeasurementsCm; label: string }> = [
  { key: 'neck', label: 'Neck' },
  { key: 'chest', label: 'Chest' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'thigh', label: 'Thigh' },
  { key: 'arm', label: 'Arm' },
  { key: 'calf', label: 'Calf' },
];

export function MeasurementEntry({ units, onDone }: { units: UnitSystem; onDone: () => void }) {
  const toast = useToast();
  const record = useRecordMeasurement();

  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [tape, setTape] = useState<Record<string, string>>({});
  const [showTape, setShowTape] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async () => {
    const next: Record<string, string> = {};

    const raw = Number.parseFloat(weight);
    if (!Number.isFinite(raw) || raw <= 0) next.weight = 'Enter your weight.';
    const weightKg = units === 'metric' ? raw : lbToKg(raw);
    if (Number.isFinite(weightKg) && (weightKg < 20 || weightKg > 500)) {
      next.weight = 'That does not look like a plausible weight.';
    }

    let bodyFatPct: number | undefined;
    if (bodyFat.trim()) {
      const parsed = Number.parseFloat(bodyFat);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 75) {
        next.bodyFat = 'Enter a percentage between 0 and 75.';
      } else {
        bodyFatPct = parsed;
      }
    }

    const tapeCm: TapeMeasurementsCm = {};
    for (const field of TAPE_FIELDS) {
      const value = tape[field.key]?.trim();
      if (!value) continue;
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed > 0) {
        tapeCm[field.key] = units === 'metric' ? parsed : inToCm(parsed);
      }
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      const result = await record.mutateAsync({
        date: new Date().toISOString().slice(0, 10),
        weightKg: Math.round(weightKg * 100) / 100,
        ...(bodyFatPct !== undefined ? { bodyFatPct } : {}),
        ...(Object.keys(tapeCm).length > 0 ? { tapeCm } : {}),
      });

      toast.show(
        result.queued ? 'Saved on this device — it will sync later.' : 'Measurement saved.',
        'success',
      );
      onDone();
    } catch {
      toast.show('Could not save that measurement.', 'error');
    }
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <NumberField
        label="Weight"
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
        value={bodyFat}
        onChange={(event) => setBodyFat(event.target.value)}
        {...(errors.bodyFat ? { error: errors.bodyFat } : {})}
      />

      <button
        type="button"
        onClick={() => setShowTape((v) => !v)}
        aria-expanded={showTape}
        className="min-h-touch text-left text-sm font-medium text-accent active:opacity-70"
      >
        {showTape ? 'Hide tape measurements' : 'Add tape measurements (optional)'}
      </button>

      {showTape ? (
        <div className="grid grid-cols-2 gap-3">
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
            />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button type="submit" loading={record.isPending}>
          Save
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
