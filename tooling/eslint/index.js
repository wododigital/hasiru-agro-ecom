// Shared flat config for the whole workspace. The root eslint.config.js re-exports it,
// so `eslint .` inside any package resolves here. File globs are relative to the repo root.
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** Public entry points only: `@ecomkit/<mod>/<export>`, never `src/**` or a relative hop into another package. */
export const boundaryPatterns = [
  {
    group: ['@ecomkit/*/src', '@ecomkit/*/src/**'],
    message: 'Import another module through its package exports (manifest, schema, domain, server, ui, admin, routes/*, messages), never its src.',
  },
  {
    group: ['**/packages/*/src', '**/packages/*/src/**', '../../*/src/**', '../../../*/src/**', '../../../../*/src/**', '../../../../../*/src/**'],
    message: 'Relative imports across packages are forbidden. Use the @ecomkit/<mod> exports.',
  },
];

const domainPatterns = [
  ...boundaryPatterns,
  {
    group: ['react', 'react-dom', 'react/*', 'next', 'next/*', 'drizzle-orm', 'drizzle-orm/*', 'pg', 'pg-boss', 'server-only'],
    message: 'domain/ is pure TypeScript: no React, no Next, no database.',
  },
];

/** Punctuation and symbols that may appear as JSX text; words always come from messages. */
export const allowedJsxStrings = ['·', '/', '×', 'x', '+', '-', '|', ':', '(', ')', '%', '*', '•', '→', '←', '…', ',', '.'];

/** Storefront surfaces where every visible string must come from a messages object. */
export const copyFiles = ['packages/*/src/ui/**/*.tsx', 'packages/*/src/routes/**/*.tsx', 'apps/*/app/**/*.tsx'];
export const copyExemptFiles = ['apps/*/app/(admin)/**'];
/** Attributes whose text a visitor sees or hears. */
export const copyAttributes = ['alt', 'title', 'placeholder', 'aria-label', 'aria-description', 'aria-placeholder', 'aria-roledescription', 'aria-valuetext', 'label'];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '.worktrees/**',
      '_work/**',
      'site/**',
      'images/**',
      'data/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '19.3' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/jsx-key': 'error',
      'react/no-danger': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-restricted-imports': ['error', { patterns: boundaryPatterns }],
    },
  },
  {
    // Workspace scripts load packages at runtime through the app graph and may reference their types relatively.
    files: ['tooling/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [boundaryPatterns[0]] }] },
  },
  {
    files: ['packages/*/src/domain/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: domainPatterns }] },
  },
  {
    files: copyFiles,
    ignores: copyExemptFiles,
    rules: {
      // ignoreProps: true, because with false the rule rejects every attribute string (className, href, lang).
      // Visible attributes are covered by the selector below instead.
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: allowedJsxStrings }],
      'no-restricted-syntax': [
        'error',
        {
          selector: `JSXAttribute[name.name=/^(${copyAttributes.join('|')})$/] > Literal[value=/[A-Za-z]/]`,
          message: 'Visible attribute text comes from messages, not a literal.',
        },
        {
          selector: `JSXAttribute[name.name=/^(${copyAttributes.join('|')})$/] > JSXExpressionContainer > :matches(Literal[value=/[A-Za-z]/], TemplateLiteral)`,
          message: 'Visible attribute text comes from messages, not a literal.',
        },
      ],
    },
  },
  {
    files: ['apps/*/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
);
