/**
 * Height, birth year, sex and activity level — what the maintenance formula needs.
 *
 * Optional. With it, a new user gets calorie targets on day one; without it the
 * app waits for a measured weight trend. Height is stored in centimetres and only
 * shown in inches for imperial users.
 */
import { useState } from 'react';
import type { ActivityLevel, AuthUser, BodyProfile, UserUpdateInput } from '@app/shared-types';
import { Button, Card, NumberField, SelectField } from '@/shared/components/Field';
import { ACTIVITY_LABEL } from '@/shared/lib/maintenanceFormula';

const CM_PER_IN = 2.54;

export function BodyProfileCard({
  user,
  saving,
  onSave,
}: {
  user: AuthUser;
  saving: boolean;
  onSave: (patch: UserUpdateInput) => void;
}) {
  const imperial = user.units === 'imperial';
  const body = user.body;
  const [height, setHeight] = useState(
    body ? String(imperial ? Math.round(body.heightCm / CM_PER_IN) : body.heightCm) : '',
  );
  const [birthYear, setBirthYear] = useState(body ? String(body.birthYear) : '');
  const [sex, setSex] = useState<BodyProfile['sex'] | ''>(body?.sex ?? '');
  const [activity, setActivity] = useState<ActivityLevel>(body?.activityLevel ?? 'light');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const thisYear = new Date().getFullYear();

  const save = () => {
    const next: Record<string, string> = {};
    const h = Number(height);
    const heightCm = imperial ? h * CM_PER_IN : h;
    if (!height || !Number.isFinite(heightCm) || heightCm < 120 || heightCm > 230) {
      next.height = imperial
        ? 'Enter a height between 48 and 90 in.'
        : 'Enter a height between 120 and 230 cm.';
    }
    const y = Number(birthYear);
    if (!Number.isInteger(y) || y < thisYear - 100 || y > thisYear - 13) {
      next.birthYear = `Enter a year between ${thisYear - 100} and ${thisYear - 13}.`;
    }
    if (!sex) next.sex = 'Choose one; the formula has a separate equation for each.';
    setErrors(next);
    if (Object.keys(next).length > 0 || !sex) return;

    onSave({
      body: { heightCm: Math.round(heightCm), birthYear: y, sex, activityLevel: activity },
    });
  };

  return (
    <Card>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <div>
          <h2 className="text-sm font-medium text-text-muted">Body profile</h2>
          <p className="text-sm text-text-muted">
            Used to estimate your maintenance calories until your own weight trend can measure it,
            so you get targets from day one.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Height"
            unit={imperial ? 'in' : 'cm'}
            value={height}
            onChange={(event) => setHeight(event.target.value)}
            {...(errors.height ? { error: errors.height } : {})}
          />
          <NumberField
            label="Birth year"
            placeholder="1996"
            value={birthYear}
            onChange={(event) => setBirthYear(event.target.value)}
            {...(errors.birthYear ? { error: errors.birthYear } : {})}
          />
        </div>

        <SelectField
          label="Sex"
          hint="Only used by the calorie formula, which has one equation for each."
          value={sex}
          onChange={(event) => setSex(event.target.value as BodyProfile['sex'] | '')}
          options={[
            { value: '', label: 'Choose…' },
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
          {...(errors.sex ? { error: errors.sex } : {})}
        />

        <SelectField
          label="Activity level"
          hint="Count training and daily movement. When unsure, pick the lower one: most people overestimate."
          value={activity}
          onChange={(event) => setActivity(event.target.value as ActivityLevel)}
          options={(Object.keys(ACTIVITY_LABEL) as ActivityLevel[]).map((level) => ({
            value: level,
            label: ACTIVITY_LABEL[level],
          }))}
        />

        <Button type="submit" loading={saving}>
          Save body profile
        </Button>
      </form>
    </Card>
  );
}
