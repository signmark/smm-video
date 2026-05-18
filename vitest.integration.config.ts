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
    setupFiles: ['./server/__tests__/setup.integration.ts'],
    deps: { inline: [/express/] },
    include: [
      'server/__tests__/social-publishing-integration.test.ts'
    ],
    testTimeout: 90_000,
    hookTimeout: 90_000,
  },
});
