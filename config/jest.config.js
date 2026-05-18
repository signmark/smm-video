/** @type {import('ts-jest').JestConfigWithTsJest} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    "**/__tests__/**/*.test.ts"
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
        isolatedModules: true,
        useESM: true
      }
    ]
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/client/src/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@server/(.*)$': '<rootDir>/server/$1'
  },
  setupFilesAfterEnv: [
    '<rootDir>/server/__tests__/jest.setup.js'
  ],
  maxWorkers: 1, // Ограничиваем количество параллельных тестов для предотвращения конфликтов
  verbose: true, // Включаем подробный вывод
  testTimeout: 30000, // Устанавливаем таймаут для тестов в 30 секунд
  collectCoverage: false, // Не собираем покрытие кода по умолчанию
  // Исключаем из тестирования определенные директории
  testPathIgnorePatterns: [
    '/node_modules/',
    '/.replit/'
  ],
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
};

export default config;