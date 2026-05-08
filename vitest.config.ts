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
        'web/**/*.ts',
        // Chrome / Safari ext 의 lint·test 대상 손으로 작성하는 코드 (popup / background).
        'chrome-extension/background/**/*.js',
        'chrome-extension/popup/**/*.js',
        'safari-extension/**/Resources/background/**/*.js',
        'safari-extension/**/Resources/popup*/**/*.js',
      ],
      exclude: [
        '**/node_modules/**',
        '**/*.test.*',
        // 자동 생성 산출물 (web/ 에서 esbuild 로 빌드 — 편집 금지).
        'chrome-extension/content-scripts/*.js',
        'safari-extension/**/Resources/content-scripts/*.js',
        'safari-extension/**/Resources/webview-scripts/*.js',
        'safari-extension/**/iOS (App)/Resources/webview-scripts/*.js',
        'android-app/**/assets/webview-scripts/*.js',
        // entries/* 는 IIFE — production 에서만 실행되고 테스트가 직접 import 안 함.
        // 신호는 entries 가 호출하는 web/core/* 에 잡힌다.
        'web/entries/**/*.ts',
        // type-only / ambient 선언 — runtime 코드 0.
        'web/platform/adapter.ts',
        '**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@shared': new URL('./shared', import.meta.url).pathname,
    },
  },
});
