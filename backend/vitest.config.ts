import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@app/shared-types': fileURLToPath(
        new URL('../packages/shared-types/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    // Every test must pass with zero credentials and zero network access.
    env: { NODE_ENV: 'test' },
  },
});
