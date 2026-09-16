/**
 * Form primitives.
 *
 * Centralised because the mobile input rules are easy to forget one screen at a
 * time, and every one of them has a visible consequence on a phone:
 *
 *  - `text-base` (16px) — below this, iOS Safari zooms the viewport on focus and
 *    the layout lurches sideways mid-entry.
 *  - `inputMode="decimal"` for weights and macros, so the numeric keypad appears
 *    with a decimal point instead of the full keyboard.
 *  - `min-h-touch` (44px) on every control.
 *  - The label is a real `<label>` bound by id, and the error is tied to the input
 *    by `aria-describedby`, so it is announced rather than merely shown.
 *  - `enterKeyHint` so the on-screen return key says what it does.
 */
import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

interface FieldWrapperProps {
  label: string;
  hint?: string;
  error?: string;
  /** Renders "Optional" next to the label, so required is the unmarked default. */
  optional?: boolean;
  children: (ids: { inputId: string; describedBy: string | undefined }) => ReactNode;
}

function FieldWrapper({ label, hint, error, optional, children }: FieldWrapperProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="flex items-baseline gap-2 text-sm font-medium text-text">
        {label}
        {optional ? <span className="text-xs font-normal text-text-muted">Optional</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      ) : null}
      {children({ inputId, describedBy: describedBy || undefined })}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const CONTROL_CLASS =
  'min-h-touch w-full rounded-lg border border-border bg-surface-raised px-3 text-base text-text ' +
  'placeholder:text-text-muted focus:border-accent focus:outline-none';

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
};

export function TextField({ label, hint, error, optional, ...input }: TextFieldProps) {
  return (
    <FieldWrapper
      label={label}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      {...(optional ? { optional } : {})}
    >
      {({ inputId, describedBy }) => (
        <input
          id={inputId}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className={`${CONTROL_CLASS} ${error ? 'border-danger' : ''}`}
          {...input}
        />
      )}
    </FieldWrapper>
  );
}

type NumberFieldProps = Omit<TextFieldProps, 'type'> & { unit?: string };

/**
 * Numeric entry.
 *
 * `type="text"` with `inputMode="decimal"` rather than `type="number"`: a number
 * input shows spinners nobody taps, rejects intermediate states like "88." while
 * typing, and on some Android keyboards still offers a comma the parser rejects.
 */
export function NumberField({ label, hint, error, optional, unit, ...input }: NumberFieldProps) {
  return (
    <FieldWrapper
      label={label}
      {...(hint ? { hint } : {})}
      {...(error ? { error } : {})}
      {...(optional ? { optional } : {})}
    >
      {({ inputId, describedBy }) => (
        <div className="relative flex items-center">
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className={`${CONTROL_CLASS} ${unit ? 'pr-12' : ''} ${error ? 'border-danger' : ''}`}
            {...input}
          />
          {unit ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute right-3 text-sm text-text-muted"
            >
              {unit}
            </span>
          ) : null}
        </div>
      )}
    </FieldWrapper>
  );
}

type SelectFieldProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
  label: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string }>;
};

export function SelectField({ label, hint, error, options, ...select }: SelectFieldProps) {
  return (
    <FieldWrapper label={label} {...(hint ? { hint } : {})} {...(error ? { error } : {})}>
      {({ inputId, describedBy }) => (
        <select id={inputId} aria-describedby={describedBy} className={CONTROL_CLASS} {...select}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </FieldWrapper>
  );
}

interface ButtonProps {
  children: ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  disabled?: boolean;
  /** Shows a busy state and blocks repeat taps — the double-submit guard. */
  loading?: boolean;
  fullWidth?: boolean;
}

const VARIANT_CLASS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-accent text-accent-text',
  secondary: 'border border-border bg-surface-raised text-text',
  ghost: 'text-accent',
  danger: 'border border-danger/40 text-danger',
};

export function Button({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  disabled,
  loading,
  fullWidth = true,
}: ButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      // Blocked while loading: on a slow connection the user WILL tap twice.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[
        'min-h-touch rounded-lg px-5 font-medium transition-opacity',
        'active:opacity-80 disabled:opacity-50',
        fullWidth ? 'w-full' : '',
        VARIANT_CLASS[variant],
      ].join(' ')}
    >
      {loading ? 'Working…' : children}
    </button>
  );
}

/** Page shell: single column, safe-area gutters, clear of the tab bar. */
export function Screen({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-content-max px-safe pb-nav pt-safe">
      {title ? <h1 className="py-4 text-2xl font-semibold text-text">{title}</h1> : null}
      {children}
    </main>
  );
}

/** Standard surface for a grouped block of content. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-border bg-surface p-4 shadow-card ${className}`}>
      {children}
    </section>
  );
}
