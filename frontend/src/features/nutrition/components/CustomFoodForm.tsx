/**
 * Creates one of the user's own foods.
 *
 * Works offline, which is the point: a user standing in their kitchen with no
 * signal can still record a recipe and log it.
 */
import { useState } from 'react';
import { Button, NumberField, TextField } from '@/shared/components/Field';
import { useToast } from '@/shared/components/Toast';
import { useCreateCustomFood } from '../hooks/useCustomFoods';

interface CustomFoodFormProps {
  onDone: () => void;
}

export function CustomFoodForm({ onDone }: CustomFoodFormProps) {
  const toast = useToast();
  const create = useCreateCustomFood();

  const [name, setName] = useState('');
  const [servingLabel, setServingLabel] = useState('');
  const [calories, setCalories] = useState('');
  const [protein, setProtein] = useState('');
  const [carbs, setCarbs] = useState('');
  const [fat, setFat] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const num = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the food a name.';

    const kcal = Number.parseFloat(calories);
    if (!Number.isFinite(kcal) || kcal < 0) next.calories = 'Enter the calories per serving.';

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        ...(servingLabel.trim() ? { servingLabel: servingLabel.trim() } : {}),
        calories: kcal,
        proteinG: num(protein),
        carbsG: num(carbs),
        fatG: num(fat),
      });

      toast.show(
        result.queued ? 'Saved on this device — it will sync when you reconnect.' : 'Food saved.',
        'success',
      );
      onDone();
    } catch {
      toast.show('Could not save that food.', 'error');
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
      <TextField
        label="Name"
        placeholder="Overnight oats"
        value={name}
        onChange={(event) => setName(event.target.value)}
        {...(errors.name ? { error: errors.name } : {})}
      />

      <TextField
        label="Serving"
        optional
        hint="What one serving is, e.g. '1 bowl' or '100 g'."
        placeholder="1 bowl"
        value={servingLabel}
        onChange={(event) => setServingLabel(event.target.value)}
      />

      <NumberField
        label="Calories per serving"
        unit="kcal"
        value={calories}
        onChange={(event) => setCalories(event.target.value)}
        {...(errors.calories ? { error: errors.calories } : {})}
      />

      <div className="grid grid-cols-3 gap-3">
        <NumberField
          label="Protein"
          unit="g"
          value={protein}
          onChange={(event) => setProtein(event.target.value)}
        />
        <NumberField
          label="Carbs"
          unit="g"
          value={carbs}
          onChange={(event) => setCarbs(event.target.value)}
        />
        <NumberField
          label="Fat"
          unit="g"
          value={fat}
          onChange={(event) => setFat(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Button type="submit" loading={create.isPending}>
          Save food
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
