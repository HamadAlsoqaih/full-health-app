/**
 * The serving-size field, both ways of entering one.
 *
 * The case that shaped it: a bucket the scan called "8 pieces", five of which
 * were eaten. Typed mode has to accept `5/8`; the picker has to be able to
 * reach it by scrolling; and neither may quietly turn it into something else.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ServingSizeField } from '@/shared/components/ServingSizeField';

/** Wraps the field in the state a real parent would hold. */
function Harness({
  initial = 1,
  servingLabel = '8 pieces',
  onValue,
}: {
  initial?: number | null;
  servingLabel?: string;
  onValue?: (value: number | null) => void;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <ServingSizeField
      value={value}
      servingLabel={servingLabel}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}

/** The field remembers its mode, so each test starts from a known one. */
function resetMode(): void {
  localStorage.clear();
}

describe('typed mode', () => {
  it('accepts a fraction and reports its value', async () => {
    resetMode();
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);

    const input = screen.getByLabelText('Serving size');
    await user.clear(input);
    await user.type(input, '5/8');

    expect(onValue).toHaveBeenLastCalledWith(0.625);
  });

  it('shows what the fraction is a fraction OF', async () => {
    resetMode();
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText('Serving size');
    await user.clear(input);
    await user.type(input, '5/8');

    // "0.625" on its own is unverifiable; "5/8 of 8 pieces" can be checked
    // against the bucket in front of you. Read off the live region rather than
    // the document, since the hint text mentions 8 pieces too.
    const summary = document.querySelector('[aria-live="polite"]');
    expect(summary).toHaveTextContent('5/8');
    expect(summary).toHaveTextContent(/of 8 pieces/);
  });

  it('accepts a mixed number', async () => {
    resetMode();
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} servingLabel="1 plate" />);

    const input = screen.getByLabelText('Serving size');
    await user.clear(input);
    await user.type(input, '2 1/2');

    expect(onValue).toHaveBeenLastCalledWith(2.5);
  });

  it('reports null for nonsense rather than guessing a serving', async () => {
    resetMode();
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);

    const input = screen.getByLabelText('Serving size');
    await user.clear(input);
    await user.type(input, 'abc');

    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(screen.getByText(/Nothing to log yet/)).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('uses a 16px control, so iOS does not zoom the page on focus', () => {
    resetMode();
    render(<Harness />);
    // text-base is 1rem in the token scale, which is the documented floor for
    // anything typed into on iOS.
    expect(screen.getByLabelText('Serving size').className).toContain('text-base');
  });
});

describe('picker mode', () => {
  it('can reach 5 of 8 pieces by picking', async () => {
    resetMode();
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);

    await user.click(screen.getByRole('button', { name: 'Pick' }));

    // Whole part 0, fraction 5/8 — which is only possible because the whole
    // wheel starts at 0 and the fraction list includes eighths.
    await user.selectOptions(screen.getByLabelText('Whole'), '0');
    await user.selectOptions(screen.getByLabelText('Fraction'), '5/8');

    expect(onValue).toHaveBeenLastCalledWith(0.625);
  });

  it('combines a whole number and a fraction into a mixed amount', async () => {
    resetMode();
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} servingLabel="1 plate" />);

    await user.click(screen.getByRole('button', { name: 'Pick' }));
    await user.selectOptions(screen.getByLabelText('Whole'), '2');
    await user.selectOptions(screen.getByLabelText('Fraction'), '1/2');

    expect(onValue).toHaveBeenLastCalledWith(2.5);
  });

  it('offers every fraction needed for the counts food comes in', async () => {
    resetMode();
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Pick' }));

    const options = [...screen.getByLabelText('Fraction').querySelectorAll('option')].map(
      (option) => option.textContent,
    );

    // Halves through tenths: a bucket of 6, 8 or 10 pieces all have to be
    // expressible, which is the whole reason the list is this long.
    for (const label of ['1/8', '1/6', '1/5', '1/4', '1/3', '1/2', '5/8', '2/3', '3/4', '3/10']) {
      expect(options).toContain(label);
    }
  });

  it('refuses zero rather than logging an empty meal', async () => {
    resetMode();
    const onValue = vi.fn();
    const user = userEvent.setup();
    render(<Harness onValue={onValue} />);

    await user.click(screen.getByRole('button', { name: 'Pick' }));
    await user.selectOptions(screen.getByLabelText('Whole'), '0');
    await user.selectOptions(screen.getByLabelText('Fraction'), 'none');

    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('alert')).toHaveTextContent(/at least a fraction/i);
  });
});

describe('switching between the two', () => {
  it('carries a typed fraction onto the wheels', async () => {
    resetMode();
    const user = userEvent.setup();
    render(<Harness />);

    const input = screen.getByLabelText('Serving size');
    await user.clear(input);
    await user.type(input, '5/8');
    await user.click(screen.getByRole('button', { name: 'Pick' }));

    // The choice survives the switch instead of resetting to one serving.
    expect(screen.getByLabelText('Whole')).toHaveValue('0');
    expect(screen.getByLabelText('Fraction')).toHaveValue('5/8');
  });

  it('carries a picked amount back into the text field', async () => {
    resetMode();
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Pick' }));
    await user.selectOptions(screen.getByLabelText('Whole'), '1');
    await user.selectOptions(screen.getByLabelText('Fraction'), '3/4');
    await user.click(screen.getByRole('button', { name: 'Type' }));

    expect(screen.getByLabelText('Serving size')).toHaveValue('1 3/4');
  });

  it('remembers the mode for next time', async () => {
    resetMode();
    const user = userEvent.setup();
    const first = render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Pick' }));
    first.unmount();

    // Re-mounted as it would be on the next meal: still the picker, so the
    // preference is not re-chosen every time.
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Pick' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('marks the active mode for assistive technology, not just visually', () => {
    resetMode();
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Type' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Pick' })).toHaveAttribute('aria-pressed', 'false');
  });
});
