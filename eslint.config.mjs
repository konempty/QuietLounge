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
        files: ['*.user.js'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'script',
            globals: { ...globals.browser, ...globals.greasemonkey },
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            'no-undef': 'off',
        },
    },
];
