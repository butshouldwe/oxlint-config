// Strict oxlint preset: baseline for the package inheritance tests.
import { antipattern, correctness, effectNative } from '@effect/tsgo/oxlint-presets';
import { defineConfig } from 'oxlint';
import antiSlop from 'ultracite/oxlint/anti-slop';

export default defineConfig({
  extends: [correctness, antipattern, effectNative, antiSlop],
  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'error',
    style: 'off',
  },
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    // Formatter-shaped (blank lines); thousands of hits. oxfmt owns layout.
    'anti-slop/require-readable-spacing': 'off',
  },
  ignorePatterns: [
    '**/dist',
    '**/node_modules',
    '**/.agents/**',
    '**/.claude/**',
    '**/.agents/skills',
    '**/.claude/skills',
  ],
});
