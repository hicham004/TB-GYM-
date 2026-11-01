// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = defineConfig([
  {
    ignores: ['src/app/core/api/generated/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // GSAP stays on the homepage (docs/MOTION-PLAN-2026-11.md, W1): the app's moments run on the Web
    // Animations API through core/motion, so nothing downloads at a moment.
    files: ['**/*.ts'],
    ignores: ['src/app/features/home/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['gsap', 'gsap/*'],
              message: 'GSAP stays on the homepage; the app moves through core/motion (W1).',
            },
          ],
        },
      ],
    },
  },
  {
    // core/motion imports nothing but Angular (and its own files), so ui/** can import it without
    // pulling anything else in.
    files: ['src/app/core/motion/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!@angular/|\\./)',
              message: 'core/motion imports nothing but Angular (W1).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
]);
