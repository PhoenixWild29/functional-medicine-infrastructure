// Extends Jest's `expect` with DOM-specific matchers like toBeInTheDocument,
// toHaveAttribute, toHaveTextContent, etc. Imported once globally via
// jest.config's setupFilesAfterEach option.
import '@testing-library/jest-dom'
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util'

// Every browser has TextEncoder; jsdom does not. The qrcode package (the
// sign-up link's QR code, drawn in the browser) encodes with it.
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder: NodeTextEncoder, TextDecoder: NodeTextDecoder })
}

// Compliance C2: every server path that reads or writes PHI calls
// logPhiAccess, which inserts into phi_access_log through the service
// client. Mocked here for every test so route tests' fake databases see no
// extra write; a route test asserts on this mock (exactly one call per
// request), and src/lib/audit/__tests__/phi-access.test.ts unmocks it to
// test the helper itself.
jest.mock('@/lib/audit/phi-access', () => ({
  ...jest.requireActual('@/lib/audit/phi-access'),
  logPhiAccess: jest.fn(async () => true),
  logPhiAccessMany: jest.fn(async () => true),
  logPhiDisclosure: jest.fn(async () => true),
  logPhiAccessBatch: jest.fn(async () => true),
  logPhiWriteNotCompleted: jest.fn(async () => true),
}))

// Security review L7: the shared rate-limit count (rate_limit_hit RPC).
// Mocked here so route tests' fake databases see no extra call; null is
// "no shared count", so only the in-memory limit applies. A route test
// makes it answer over the limit to check its 429, and
// src/lib/security/__tests__/db-rate-limit.test.ts unmocks it.
jest.mock('@/lib/security/db-rate-limit', () => ({
  dbRateLimitHit: jest.fn(async () => null),
}))
