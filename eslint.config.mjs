import tseslint from 'typescript-eslint';

/**
 * Single root config for every workspace. Run from the repo root with `npm run lint`.
 *
 * The `no-restricted-imports` block on the backend is load-bearing, not style:
 * the Supabase service-role key bypasses row-level security entirely, so the module
 * holding it may only be imported from the few places that genuinely have no user JWT.
 * See docs/DEVIATIONS.md ("RLS vs service role").
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/dev-dist/**',
      '**/*.generated.css',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['backend/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '../config/supabaseAdmin.js',
              message:
                'The service-role client bypasses RLS. Import it only from scripts/, jobs/, services/notifications/, services/users/ or repositories/supabase/admin-writes.ts.',
            },
          ],
          patterns: [
            {
              group: ['**/config/supabaseAdmin', '**/config/supabaseAdmin.js'],
              message:
                'The service-role client bypasses RLS. Import it only from scripts/, jobs/, services/notifications/, services/users/ or repositories/supabase/admin-writes.ts.',
            },
          ],
        },
      ],
    },
  },
  {
    // The allowlist: these genuinely run without a user JWT.
    files: [
      'backend/src/scripts/**/*.ts',
      'backend/src/jobs/**/*.ts',
      'backend/src/services/notifications/**/*.ts',
      'backend/src/services/users/**/*.ts',
      'backend/src/repositories/supabase/admin-writes.ts',
      'backend/src/config/supabaseAdmin.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: [
      '**/*.config.ts',
      '**/*.config.mjs',
      '**/scripts/**/*.ts',
      '**/tests/**/*.ts',
      '**/tests/**/*.tsx',
    ],
    rules: { 'no-console': 'off' },
  },
);
