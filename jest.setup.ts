// Extends Jest's `expect` with DOM-specific matchers like toBeInTheDocument,
// toHaveAttribute, toHaveTextContent, etc. Imported once globally via
// jest.config's setupFilesAfterEach option.
import '@testing-library/jest-dom'

// Compliance C2: every server path that reads or writes PHI calls
// logPhiAccess, which inserts into phi_access_log through the service
// client. Mocked here for every test so route tests' fake databases see no
// extra write; a route test asserts on this mock (exactly one call per
// request), and src/lib/audit/__tests__/phi-access.test.ts unmocks it to
// test the helper itself.
jest.mock('@/lib/audit/phi-access', () => ({
  ...jest.requireActual('@/lib/audit/phi-access'),
  logPhiAccess: jest.fn(async () => undefined),
}))
