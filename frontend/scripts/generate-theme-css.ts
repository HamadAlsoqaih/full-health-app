/**
 * Emits `src/shared/theme/theme.generated.css` from `src/shared/theme/tokens.ts`.
 *
 * Tailwind 4 is configured in CSS, not JavaScript, so this codegen is what keeps
 * tokens.ts authoritative instead of decorative. Run automatically by `predev` and
 * `prebuild`; `--check` fails if the checked-in file is stale, which is what CI runs.
 *
 * The `@theme inline` block matters: it makes Tailwind emit `var(--fh-…)` inside each
 * utility rather than a literal colour, so `bg-surface` follows the dark-mode override
 * below without needing a `dark:` variant on every element.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import {
  colors,
  fontFamily,
  fontSize,
  radius,
  shadow,
  spacing,
  spacingBase,
} from '../src/shared/theme/tokens.ts';

const OUT = fileURLToPath(new URL('../src/shared/theme/theme.generated.css', import.meta.url));

const indent = (lines: string[], depth = 1) =>
  lines.map((l) => `${'  '.repeat(depth)}${l}`).join('\n');

const colorVars = (scheme: 'light' | 'dark', depth = 1) =>
  indent(
    Object.entries(colors[scheme]).map(([role, value]) => `--fh-${role}: ${value};`),
    depth,
  );

const themeColorMap = indent(
  Object.keys(colors.light).map((role) => `--color-${role}: var(--fh-${role});`),
);

const fontSizeMap = indent(
  Object.entries(fontSize).flatMap(([key, { size, lineHeight }]) => [
    `--text-${key}: ${size};`,
    `--text-${key}--line-height: ${lineHeight};`,
  ]),
);

const spacingMap = indent(Object.entries(spacing).map(([k, v]) => `--spacing-${k}: ${v};`));
const radiusMap = indent(Object.entries(radius).map(([k, v]) => `--radius-${k}: ${v};`));
const shadowMap = indent(Object.entries(shadow).map(([k, v]) => `--shadow-${k}: ${v};`));
const fontMap = indent(Object.entries(fontFamily).map(([k, v]) => `--font-${k}: ${v};`));

const css = `/*
 * GENERATED FILE — DO NOT EDIT.
 * Source: src/shared/theme/tokens.ts
 * Regenerate: npm run theme:generate --workspace frontend
 */

:root {
  color-scheme: light dark;
${colorVars('light')}
}

@media (prefers-color-scheme: dark) {
  :root {
${colorVars('dark', 2)}
  }
}

/* Explicit override hook, so a future in-app theme switch does not need a rebuild. */
:root[data-theme='light'] {
${colorVars('light')}
}

:root[data-theme='dark'] {
${colorVars('dark')}
}

@theme inline {
${themeColorMap}

${fontMap}

${fontSizeMap}

  --spacing: ${spacingBase};
${spacingMap}

${radiusMap}

${shadowMap}
}
`;

const check = process.argv.includes('--check');

if (check) {
  if (!existsSync(OUT)) {
    console.error('theme.generated.css is missing. Run: npm run theme:generate');
    process.exit(1);
  }
  if (readFileSync(OUT, 'utf8') !== css) {
    console.error(
      'theme.generated.css is stale — it does not match tokens.ts.\nRun: npm run theme:generate',
    );
    process.exit(1);
  }
  console.log('theme.generated.css is up to date with tokens.ts');
} else {
  writeFileSync(OUT, css);
  console.log(`wrote ${OUT}`);
}
