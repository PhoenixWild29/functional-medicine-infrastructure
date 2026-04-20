import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({ dir: './' })

const config: Config = {
  // Use jsdom for component tests; individual files can override with @jest-environment node
  testEnvironment: 'jest-environment-jsdom',

  // Extend expect() with @testing-library/jest-dom matchers (toBeInTheDocument, etc.)
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],

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
  // No coverage threshold enforced. The repo is bootstrapping unit-test
  // coverage (hipaa-timeout.test.tsx is the first). `npm run test:coverage`
  // still computes + uploads the report as a CI artifact for observability.
  // Revisit when:
  //   - 5+ test files exist → add per-file thresholds as each test lands
  //   - global coverage crosses 50% organically → set global threshold to
  //     (current - 5%) as a ratchet so we don't regress
  //   - team size > 3 → add a coverage-diff check on new code
  coverageReporters: ['text', 'lcov', 'html'],

  // Module aliases (matches tsconfig paths)
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

export default createJestConfig(config)
