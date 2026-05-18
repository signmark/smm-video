/**
 * Jest конфигурация
 * Запускает только тесты без vitest-импортов.
 * Остальные тесты (47 файлов с 'vitest') запускаются через: npm run test:run
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: './',

  // Только файлы, которые НЕ импортируют vitest
  testMatch: [
    '<rootDir>/server/__tests__/facebook-token-validation.test.ts',
    '<rootDir>/server/__tests__/system-utils.test.ts',
    '<rootDir>/server/__tests__/youtube-oauth-flow.test.ts',
  ],

  testPathIgnorePatterns: [
    '<rootDir>/node_modules/',
    '<rootDir>/dist/',
  ],

  clearMocks: true,
  restoreMocks: true,

  collectCoverage: false,
  collectCoverageFrom: [
    'server/services/**/*.ts',
    'server/routes/**/*.ts',
    '!server/**/*.d.ts',
    '!server/**/*.test.ts',
    '!server/__tests__/**',
  ],
  coverageReporters: ['text', 'text-summary', 'html'],
  coverageDirectory: '<rootDir>/coverage',

  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        moduleResolution: 'node',
        target: 'es2020',
        module: 'commonjs',
        types: ['node', 'jest'],
        strict: false,
      }
    }]
  },

  moduleFileExtensions: ['ts', 'js', 'json'],

  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/client/src/$1',
    '^@server/(.*)$': '<rootDir>/server/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1'
  },

  testTimeout: 30000,
  automock: false,
  detectOpenHandles: true,
  maxWorkers: '50%',
  verbose: true,
  moduleDirectories: ['node_modules', '<rootDir>/server', '<rootDir>/shared'],
  testRunner: 'jest-circus/runner',
  reporters: ['default'],
};
