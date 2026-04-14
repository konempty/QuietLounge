import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,js}'],
    environment: 'node',
    globals: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'shared/**/*.ts',
        'chrome-extension/**/*.js',
        'safari-extension/**/Resources/**/*.js',
      ],
      exclude: ['**/node_modules/**', '**/*.test.*'],
    },
  },
  resolve: {
    alias: {
      '@shared': new URL('./shared', import.meta.url).pathname,
    },
  },
});
