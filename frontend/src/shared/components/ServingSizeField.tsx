/**
 * How much of a serving was eaten, entered either way.
 *
 * A serving is whatever the scan named — "8 pieces", "1 burger", "1 plate" —
 * so the serving size is very often a fraction. Two modes, because neither one
 * alone is good enough:
 *
 * - **Typed** is fastest for the ordinary answers: 1, 2, 1.5. It also accepts
 *   `5/8` and `2 1/2` directly, so a fraction never has to be converted by hand.
 * - **Picker** is for "I ate 5 of the 8 pieces", where the honest number is
 *   0.625 and nobody should be doing that division on a phone.
 *
 * The chosen mode is remembered, so whichever one suits you is not re-selected
 * at every meal.
 *
 * WHY TWO `<select>`s RATHER THAN A CUSTOM SCROLL WHEEL. On iOS a select opens
 * as the native wheel, which is exactly the two-scroll picker this is meant to
 * be — and it arrives with correct touch physics, keyboard support, screen
 * reader support and dynamic type for free. A hand-built scroll-snap wheel
 * would look the same on a desktop mock and would need real testing on real
 * hardware to get momentum, snapping and the read-back of the selected value
 * right; none of that could be verified from where this was written. Android
 * shows a scrollable list instead of a wheel, which is that platform's own
 * convention. If the wheel feel matters more than the robustness, this is the
 * one component to replace, and nothing outside it needs to change.
 */
import { useEffect, useState } from 'react';
import {
  FRACTIONS,
  WHOLE_NUMBERS,
  formatServingSize,
  isPickable,
  parseServingSize,
  toWholeAndFraction,
} from '@/shared/lib/servings';

type Mode = 'typed' | 'picker';

const MODE_KEY = 'fha.servingSize.mode.v1';

/** Reads the remembered mode. Storage can throw or be empty; typed is the default. */
function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === 'picker' ? 'picker' : 'typed';
  } catch {
    return 'typed';
  }
}

function saveMode(mode: Mode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // A private window or blocked site data. Losing the preference is fine;
    // failing to render the field over it would not be.
  }
}

export interface ServingSizeFieldProps {
  /** The serving size, or null when what is entered cannot be used. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** What ONE serving is, e.g. "8 pieces". Shown so the fraction has meaning. */
  servingLabel: string;
}

export function ServingSizeField({ value, onChange, servingLabel }: ServingSizeFieldProps) {
  const [mode, setMode] = useState<Mode>(loadMode);

  /** The raw text in typed mode, kept separate so "1/" mid-typing is allowed. */
  const [text, setText] = useState(() => (value === null ? '1' : formatServingSize(value)));

  const initial = toWholeAndFraction(value ?? 1);
  const [whole, setWhole] = useState(initial.whole);
  const [fractionLabel, setFractionLabel] = useState(initial.fraction?.label ?? '');

  useEffect(() => {
    saveMode(mode);
  }, [mode]);

  const commitTyped = (next: string) => {
    setText(next);
    onChange(parseServingSize(next));
  };

  const commitPicker = (nextWhole: number, nextFractionLabel: string) => {
    setWhole(nextWhole);
    setFractionLabel(nextFractionLabel);

    const fraction = FRACTIONS.find((f) => f.label === nextFractionLabel);
    const total = nextWhole + (fraction?.value ?? 0);
    // 0 with no fraction is zero of the meal, which is not something to log.
    onChange(total > 0 ? total : null);
  };

  const switchTo = (next: Mode) => {
    if (next === mode) return;

    if (next === 'picker') {
      // Carry the current value onto the wheels when it lands on them exactly.
      // An odd typed decimal like 1.07 does not, and must not be silently
      // rounded, so the wheels start from its whole part and the value is
      // re-reported from there.
      const split = toWholeAndFraction(value !== null && isPickable(value) ? value : (value ?? 1));
      setWhole(split.whole);
      setFractionLabel(split.fraction?.label ?? '');
      const total = split.whole + (split.fraction?.value ?? 0);
      onChange(total > 0 ? total : null);
    } else {
      setText(value === null ? '' : formatServingSize(value));
    }

    setMode(next);
  };

  const isZero = mode === 'picker' && whole === 0 && fractionLabel === '';
  const invalid = mode === 'typed' && text.trim() !== '' && value === null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-text">Serving size</span>

        {/*
          Two buttons rather than a toggle switch: a switch does not say what it
          switches to, and the current mode has to be obvious at a glance.
        */}
        <div
          role="group"
          aria-label="How to enter the serving size"
          className="flex gap-1 rounded-lg bg-surface-raised p-1"
        >
          {(
            [
              ['typed', 'Type'],
              ['picker', 'Pick'],
            ] as Array<[Mode, string]>
          ).map(([option, label]) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => switchTo(option)}
              className={[
                'min-h-touch rounded-md px-3 text-sm font-medium active:opacity-70',
                mode === option ? 'bg-surface text-text shadow-card' : 'text-text-muted',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'typed' ? (
        <div className="flex flex-col gap-1">
          <input
            aria-label="Serving size"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={invalid ? true : undefined}
            aria-describedby="serving-size-hint"
            value={text}
            onChange={(event) => commitTyped(event.target.value)}
            className={[
              'min-h-touch w-full rounded-lg border bg-surface px-3 text-base text-text',
              // 16px minimum, or iOS Safari zooms the viewport on focus.
              invalid ? 'border-danger' : 'border-border',
            ].join(' ')}
          />
          <p id="serving-size-hint" className="text-xs text-text-muted">
            {invalid
              ? 'Enter a number like 2, or a fraction like 5/8.'
              : 'Whole numbers, decimals, or a fraction — type 5/8 for 5 of 8 pieces.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <div className="flex gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-text-muted">Whole</span>
              <select
                value={String(whole)}
                onChange={(event) => commitPicker(Number(event.target.value), fractionLabel)}
                className="min-h-touch w-full rounded-lg border border-border bg-surface px-3 text-base text-text"
              >
                {WHOLE_NUMBERS.map((number) => (
                  <option key={number} value={number}>
                    {number}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-text-muted">Fraction</span>
              <select
                value={fractionLabel}
                onChange={(event) => commitPicker(whole, event.target.value)}
                className="min-h-touch w-full rounded-lg border border-border bg-surface px-3 text-base text-text"
              >
                <option value="">none</option>
                {FRACTIONS.map((fraction) => (
                  <option key={fraction.label} value={fraction.label}>
                    {fraction.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {isZero ? (
            <p role="alert" className="text-xs text-danger">
              Pick at least a fraction of a serving.
            </p>
          ) : null}
        </div>
      )}

      {/*
        What the two numbers actually mean together. Without this the fraction is
        abstract; with it you can check the answer against the food in front of
        you — "5/8 of 8 pieces" is verifiable, "0.625" is not.
      */}
      <p aria-live="polite" className="text-sm text-text-muted">
        {value === null ? (
          <span>Nothing to log yet.</span>
        ) : (
          <>
            <span className="font-medium text-text">{formatServingSize(value)}</span> of{' '}
            {servingLabel}
          </>
        )}
      </p>
    </div>
  );
}
