import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  // Use jsdom for component tests; individual files can override with @jest-environment node
  testEnvironment: 'jest-environment-jsdom',

  // Test location patterns
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/__tests__/**/*.test.tsx',
    'src/**/*.test.ts',
    'src/**/*.test.tsx',
  ],

  // Exclude E2E tests (Playwright owns those)
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/.next/'],

  // Coverage configuration
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
    '!src/types/**',
    '!src/app/**/page.tsx',   // Server components — coverage via E2E
    '!src/app/**/layout.tsx',
  ],
  coverageThreshold: {
    global: {
      branches:  80,
      functions: 80,
      lines:     80,
      statements: 80,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],

  // Module aliases (matches tsconfig paths)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

export default createJestConfig(config)
