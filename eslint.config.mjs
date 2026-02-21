import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['packages/**/*.test.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            name: 'vitest',
            importNames: ['it', 'test'],
            message: 'Import itAllure/testAllure from the package-local allure-test.js helper. Keep describe/expect from vitest.',
          },
        ],
      }],
    },
  },
];
