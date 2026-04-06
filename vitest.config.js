import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['api/**/*.js'],
      exclude: [],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
    // Ensure tests run sequentially to avoid shared mock state issues
    sequence: {
      concurrent: false,
    },
  },
});
