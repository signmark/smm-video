import { defineConfig } from 'vitest/config';
import path from 'path';

const sharedAlias = {
  '@': path.resolve(__dirname, './client/src'),
  '@shared': path.resolve(__dirname, './shared'),
};

export default defineConfig({
  test: {
    globals: true,
    alias: sharedAlias,
    deps: {
      inline: [/express/],
    },
    projects: [
      {
        // Server + shared tests — node environment (existing behaviour)
        test: {
          name: 'server',
          globals: true,
          environment: 'node',
          alias: sharedAlias,
          setupFiles: ['./server/__tests__/setup.ts'],
          include: [
            'server/__tests__/**/*.test.ts',
            'shared/__tests__/**/*.test.ts',
          ],
          exclude: [
            'server/__tests__/STORY_FLOW.test.ts',
            'server/__tests__/BUSINESS_SURVEY_REAL.test.ts',
            'server/__tests__/GEMINI_FINAL_CHECK.test.ts',
            'server/__tests__/social-publishing-integration.test.ts',
          ],
        },
      },
      {
        // Client tests — jsdom for component tests (.tsx), also covers pure-logic (.ts)
        test: {
          name: 'client',
          globals: true,
          environment: 'jsdom',
          alias: sharedAlias,
          setupFiles: ['./client/src/__tests__/setup.ts'],
          include: [
            'client/src/**/*.test.ts',
            'client/src/**/*.test.tsx',
          ],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      include: [
        'shared/**/*.ts',
        'server/utils/**/*.ts',
        'server/lib/**/*.ts',
        'server/services/**/*.ts',
        'server/routes/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/__tests__/**',
        '**/*.d.ts',
      ],
    },
  },
});
