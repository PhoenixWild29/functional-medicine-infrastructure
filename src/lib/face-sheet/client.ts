// The Anthropic client for face-sheet fill. Server only. The SDK reads
// ANTHROPIC_API_KEY itself; it is never passed around or logged. Kept in
// its own module so tests can replace it.

import Anthropic from '@anthropic-ai/sdk'

let client: Anthropic | null = null

export function faceSheetClient(): Anthropic {
  client ??= new Anthropic({ maxRetries: 1, timeout: 60_000 })
  return client
}
