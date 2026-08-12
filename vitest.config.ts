import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

const sharedAlias = {
  '@': path.resolve(__dirname, './client/src'),
  '@shared': path.resolve(__dirname, './shared'),
};

export default defineConfig({
  // AI-107: react() на верхнем уровне — иначе import-analysis в vitest
  // не понимает JSX в *.test.tsx (tsconfig "jsx": "preserve" без плагина).
  // production build использует свой plugins: [react()] в vite.config.ts.
  plugins: [react()],
  test: {
    globals: true,
    alias: sharedAlias,
    deps: {
      inline: [/express/],
    },
    projects: [
      {
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
