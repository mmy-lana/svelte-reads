import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      $lib: `${srcDir}/lib`
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Emulator-dependent suites opt in through `pnpm run test:emulator`.
    exclude: ['node_modules/**', 'src/**/*.integration.test.ts'],
    reporters: ['default']
  }
});
