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
        // 단일 source — 4 플랫폼이 esbuild 산출물로 공유하므로 coverage 신호는 여기 집중.
        'shared/**/*.ts',
        // Chrome / Safari ext 의 lint·test 대상 entry-point 들 (산출물 main.js 는 제외).
        'chrome-extension/background/**/*.js',
        'chrome-extension/popup/**/*.js',
        'chrome-extension/content-scripts/api-interceptor.js',
        'safari-extension/**/Resources/background/**/*.js',
        'safari-extension/**/Resources/popup*/**/*.js',
        'safari-extension/**/Resources/content-scripts/api-interceptor.js',
        'safari-extension/**/Resources/content-scripts/storage-bridge.js',
        'safari-extension/**/Resources/content-scripts/injector.js',
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
