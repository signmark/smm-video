import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    alias: {
      '@': path.resolve(__dirname, './client/src'),
      '@shared': path.resolve(__dirname, './shared'),
    },
    setupFiles: ['./server/__tests__/setup.ts'],
    deps: {
      inline: [/express/],
    },
    include: [
      'server/__tests__/**/*.test.ts',
      'shared/__tests__/**/*.test.ts'
    ],
    exclude: [
      'server/__tests__/STORY_FLOW.test.ts',
      'server/__tests__/BUSINESS_SURVEY_REAL.test.ts',
      'server/__tests__/GEMINI_FINAL_CHECK.test.ts',
      'server/__tests__/social-publishing-integration.test.ts'
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: [
        'shared/**/*.ts',
        'server/utils/**/*.ts',
        'server/lib/**/*.ts',
        'server/services/**/*.ts',
        'server/routes/**/*.ts'
      ],
      exclude: [
        '**/*.test.ts',
        '**/__tests__/**',
        '**/*.d.ts'
      ]
    },
    // Environment variables are loaded from .env in setup.ts
  },
});
