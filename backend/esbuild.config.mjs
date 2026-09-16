import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * `@app/shared-types` is consumed as TypeScript source (see docs/DEVIATIONS.md) so that a cold
 * clone can typecheck without a build-order step. tsc does not rewrite path aliases in its
 * output, so the runtime artifact is bundled here instead, with the alias resolved to the real
 * source file. Third-party packages stay external — they are installed on the host.
 */
await build({
  entryPoints: [resolve(here, 'src/server.ts')],
  outfile: resolve(here, 'dist/server.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  alias: {
    '@app/shared-types': resolve(here, '../packages/shared-types/src/index.ts'),
  },
  logLevel: 'info',
});
