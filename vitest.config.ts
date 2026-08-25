import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['packages/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/core/src/**/*.ts'],
      exclude: [
        'packages/core/src/**/*.test.ts',
        'packages/core/src/index.ts',
        'packages/core/src/types.ts',
      ],
    },
  },
});
