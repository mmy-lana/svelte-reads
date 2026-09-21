import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

/**
 * Config for suites that talk to the running Docker emulator suite.
 * Requires `pnpm run emulator:up` first.
 */
export default defineConfig({
  resolve: {
    alias: {
      $lib: `${srcDir}/lib`
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    reporters: ['default']
  }
});
