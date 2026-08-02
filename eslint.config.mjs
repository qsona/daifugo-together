import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '.pnpm-store/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    // packages/web はブラウザで動く SPA(E12 §4.2)。
    files: ['packages/web/src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['packages/rules/r*/**/*.ts'],
    rules: {
      'no-eval': 'error',
      'no-restricted-globals': [
        'error',
        { name: 'Date', message: 'Generated rules must be deterministic.' },
        { name: 'fetch', message: 'Generated rules cannot use the network.' },
        { name: 'process', message: 'Generated rules cannot access process.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Use RuleContext.rng instead.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'ImportExpression',
          message: 'Generated rules cannot use dynamic import.',
        },
        {
          selector: 'WhileStatement[test.value=true]',
          message: 'Generated rules cannot contain an unconditional loop.',
        },
        {
          selector: 'ForStatement[test=null]',
          message: 'Generated rules cannot contain an unconditional loop.',
        },
        {
          selector:
            "CallExpression[callee.name='Array'], NewExpression[callee.name='Array']",
          message:
            'Generated rules cannot allocate arrays by an unchecked length.',
        },
      ],
    },
  },
  {
    files: ['packages/rules/r*/rule.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!@daifugo/core$).*',
              message: 'Generated rules may import only @daifugo/core.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/rules/r*/rule.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!(?:@daifugo/core|vitest|\\./rule\\.js)$).*',
              message:
                'Generated rule tests may import only @daifugo/core, vitest, and ./rule.js.',
            },
          ],
        },
      ],
    },
  },
);
