/**
 * The single source of truth for every design token (spec §6, build step 2).
 *
 * Nothing else in the app hard-codes a colour, font size, radius or named length.
 * `frontend/scripts/generate-theme-css.ts` reads this file and emits
 * `theme.generated.css`, which is what Tailwind actually consumes. CI asserts the
 * generated file matches this source, so the two can never drift.
 *
 * Colours are declared per scheme. The generator writes the light values to `:root`
 * and the dark values into a `prefers-color-scheme: dark` block, then maps both onto
 * Tailwind's `--color-*` namespace with `@theme inline` — which is what makes a single
 * utility like `bg-surface` follow the active scheme.
 */

/** Semantic colour roles. Both schemes must declare the same keys. */
export const colors = {
  light: {
    bg: '#ffffff',
    surface: '#f5f6f8',
    'surface-raised': '#ffffff',
    border: '#e2e5ea',
    text: '#11161d',
    'text-muted': '#5c6673',
    /** Placeholder brand colour — deliberately left unbranded (spec §11). */
    accent: '#3b6fd4',
    'accent-text': '#ffffff',
    'accent-soft': '#e8eefb',
    success: '#1f7a4d',
    warning: '#9a6400',
    danger: '#b3261e',
    overlay: 'rgb(17 22 29 / 0.45)',
  },
  dark: {
    bg: '#0b0f14',
    surface: '#131922',
    'surface-raised': '#1b2330',
    border: '#2a3440',
    text: '#eef2f7',
    'text-muted': '#9aa7b6',
    accent: '#6f9bf0',
    'accent-text': '#0b0f14',
    'accent-soft': '#1a2537',
    success: '#4ecb8b',
    warning: '#e0a83a',
    danger: '#f2857d',
    overlay: 'rgb(0 0 0 / 0.6)',
  },
} as const;

/**
 * Type scale. The `base` step is 16px on purpose: iOS Safari zooms the viewport when a
 * focused input renders below 16px, so this is the floor for anything typed into.
 */
export const fontSize = {
  xs: { size: '0.75rem', lineHeight: '1rem' },
  sm: { size: '0.875rem', lineHeight: '1.25rem' },
  base: { size: '1rem', lineHeight: '1.5rem' },
  lg: { size: '1.125rem', lineHeight: '1.75rem' },
  xl: { size: '1.375rem', lineHeight: '1.875rem' },
  '2xl': { size: '1.75rem', lineHeight: '2.125rem' },
  '3xl': { size: '2.25rem', lineHeight: '2.5rem' },
} as const;

export const fontFamily = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

/** Base step for Tailwind's multiplicative spacing utilities (`p-4` = 4 × this). */
export const spacingBase = '0.25rem';

/** Named lengths that are not multiples of the base step. */
export const spacing = {
  /** Minimum interactive target: 44px per Apple HIG, 48dp per Material. */
  touch: '2.75rem',
  /** Height of the fixed bottom tab bar, excluding the safe-area inset. */
  'nav-h': '3.5rem',
  /** Comfortable single-column reading width on a phone. */
  'content-max': '32rem',
} as const;

export const radius = {
  sm: '0.375rem',
  md: '0.625rem',
  lg: '0.875rem',
  xl: '1.25rem',
  full: '9999px',
} as const;

export const shadow = {
  card: '0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.04)',
  nav: '0 -1px 0 rgb(0 0 0 / 0.06)',
} as const;

export type ColorScheme = keyof typeof colors;
export type ColorRole = keyof (typeof colors)['light'];
