// ESLint flat config (ESLint 9+) — 기존 .eslintrc.js 를 대체.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
    {
        ignores: [
            'node_modules/',
            'android-app/',
            'sample/',
            'coverage/',
            'swift-tests/',
            'safari-extension/',
            'tests/',
            '**/*.d.ts',
            // 빌드 산출물 — web/ 의 source 만 lint 대상.
            'chrome-extension/content-scripts/main.js',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    prettierConfig,
    {
        plugins: { prettier },
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.node },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_' },
            ],
            'prettier/prettier': 'warn',
        },
    },
    {
        // 확장 프로그램 JS — 브라우저/확장 API 전역
        files: ['chrome-extension/**/*.js'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
            globals: { ...globals.browser, ...globals.webextensions },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-undef': 'off',
        },
    },
    {
        // web/entries/* — IIFE 빌드 + 4 플랫폼 globalThis 차이 때문에 entry 단위 `// @ts-nocheck`,
        // iOS WKWebView 의 옛 JS 엔진 호환을 위한 var/arguments, 네이티브 bridge evaluateJavascript 가
        // JSON 결과 반환하도록 IIFE 끝의 `true;` 같은 의도된 패턴 — entry 에서 관련 룰을 풀어 둔다.
        files: ['web/entries/**/*.ts'],
        rules: {
            '@typescript-eslint/ban-ts-comment': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
            'prefer-rest-params': 'off',
            'no-var': 'off',
        },
    },
];
