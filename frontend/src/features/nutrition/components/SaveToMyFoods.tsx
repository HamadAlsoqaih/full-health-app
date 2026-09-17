/**
 * Keeps a scanned meal so it never has to be photographed again.
 *
 * The problem this solves is not day one, it is day thirty. Logging a meal by
 * photo costs a photo, a wait, and a confirmation. Eating the same thing next
 * week should not cost all of that again — with this it is two taps from the
 * custom-foods list, no AI call, no quota, no waiting.
 *
 * Three decisions worth stating:
 *
 * - **It saves the WHOLE thing, not what was eaten.** If the scan called it
 *   "8 pieces" at 2400 kcal, that is what is stored, even when only five pieces
 *   were logged. The saved item is a definition of the food; how much of it you
 *   ate is a property of each individual log entry. Storing five pieces' worth
 *   would make the entry unusable at any other portion.
 *
 * - **Everything is editable first.** This is the one real risk in saving an AI
 *   estimate: a bad number saved once is re-logged every week afterwards. So the
 *   numbers are presented as fields, not as a fait accompli.
 *
 * - **Collapsed until asked for.** Most scans get logged and forgotten. The
 *   button is one tap; the form only appears for the meals worth keeping.
 *
 * No photo is stored. Nothing about retention changes.
 */
import { useState } from 'react';
import type { FoodItem } from '@app/shared-types';
import { Button, NumberField, TextField } from '@/shared/components/Field';
import { useToast } from '@/shared/components/Toast';
import { useCreateCustomFood } from '../hooks/useCustomFoods';

interface SaveToMyFoodsProps {
  /** The estimate for the whole photo, unscaled by how much was eaten. */
  estimate: FoodItem;
}

/** Numeric field state, held as text so a half-typed value is not rejected. */
interface Draft {
  name: string;
  servingLabel: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
}

function draftFrom(estimate: FoodItem): Draft {
  return {
    // Prefilled, not fixed: the model will call it "fried chicken pieces with
    // sauce" and you may well call it something shorter.
    name: estimate.name,
    servingLabel: estimate.servingLabel,
    calories: String(Math.round(estimate.calories)),
    proteinG: String(Math.round(estimate.proteinG)),
    carbsG: String(Math.round(estimate.carbsG)),
    fatG: String(Math.round(estimate.fatG)),
  };
}

const positive = (text: string): number | null => {
  const value = Number.parseFloat(text);
  return Number.isFinite(value) && value >= 0 ? value : null;
};

export function SaveToMyFoods({ estimate }: SaveToMyFoodsProps) {
  const toast = useToast();
  const createFood = useCreateCustomFood();

  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(estimate));

  const set = (field: keyof Draft) => (value: string) =>
    setDraft((current) => ({ ...current, [field]: value }));

  const calories = positive(draft.calories);
  const proteinG = positive(draft.proteinG);
  const carbsG = positive(draft.carbsG);
  const fatG = positive(draft.fatG);

  const nameOk = draft.name.trim().length > 0;
  const numbersOk = calories !== null && proteinG !== null && carbsG !== null && fatG !== null;
  const canSave = nameOk && numbersOk;

  const save = async () => {
    if (!canSave) return;

    try {
      const result = await createFood.mutateAsync({
        name: draft.name.trim(),
        ...(draft.servingLabel.trim() ? { servingLabel: draft.servingLabel.trim() } : {}),
        calories: calories!,
        proteinG: proteinG!,
        carbsG: carbsG!,
        fatG: fatG!,
      });

      setSaved(true);
      setOpen(false);
      toast.show(
        result.queued
          ? 'Saved on this device — it will sync when you reconnect.'
          : 'Saved to your foods.',
        'success',
      );
    } catch {
      toast.show('Could not save that. Try again.', 'error');
    }
  };

  if (saved) {
    return (
      <p className="text-sm text-success" role="status">
        Saved to your foods. Next time, log it from there — no photo needed.
      </p>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Save to my foods
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-medium text-text">Save to my foods</h3>
        <p className="text-xs text-text-muted">
          Saves the whole {draft.servingLabel || 'portion'} as one item. Log any amount of it later
          without a photo. Check the numbers — a saved mistake gets re-logged every time.
        </p>
      </div>

      <TextField
        label="Name"
        value={draft.name}
        onChange={(event) => set('name')(event.target.value)}
        {...(nameOk ? {} : { error: 'Give it a name you will recognise.' })}
      />

      <TextField
        label="Serving"
        hint="What one whole serving is — 8 pieces, 1 burger, 1 plate."
        value={draft.servingLabel}
        onChange={(event) => set('servingLabel')(event.target.value)}
      />

      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Calories"
          unit="kcal"
          value={draft.calories}
          onChange={(event) => set('calories')(event.target.value)}
          {...(calories === null ? { error: 'Number needed.' } : {})}
        />
        <NumberField
          label="Protein"
          unit="g"
          value={draft.proteinG}
          onChange={(event) => set('proteinG')(event.target.value)}
          {...(proteinG === null ? { error: 'Number needed.' } : {})}
        />
        <NumberField
          label="Carbs"
          unit="g"
          value={draft.carbsG}
          onChange={(event) => set('carbsG')(event.target.value)}
          {...(carbsG === null ? { error: 'Number needed.' } : {})}
        />
        <NumberField
          label="Fat"
          unit="g"
          value={draft.fatG}
          onChange={(event) => set('fatG')(event.target.value)}
          {...(fatG === null ? { error: 'Number needed.' } : {})}
        />
      </div>

      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button onClick={() => void save()} loading={createFood.isPending} disabled={!canSave}>
          Save
        </Button>
      </div>
    </div>
  );
}
