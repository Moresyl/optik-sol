import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid({ hot: false })],
  test: {
    environment: 'happy-dom',
    include: ['packages/**/*.test.{ts,tsx}'],
    pool: 'threads',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/core/src/**/*.ts'],
      exclude: [
        'packages/core/src/**/*.test.ts',
        'packages/core/src/index.ts',
        'packages/core/src/types.ts',
      ],
      thresholds: {
        statements: 90,
        branches: 80,
        functions: 90,
        lines: 90,
      },
    },
  },
});
