// ============================================================
// The text a caught error may show the user
// ============================================================
//
// Client code throws `new Error(body.error)` with the friendly text the API
// sent, and shows err.message. That is right for those errors, but a catch
// also receives what the browser and runtime throw: "Failed to fetch",
// "Unexpected end of JSON input", "NetworkError when attempting to fetch
// resource", an aborted request, or a raw database message that slipped
// through. None of those may reach the screen. userMessage() keeps the
// friendly text and swaps everything else for the caller's fallback.

const RUNTIME_ERRORS = new Set(['TypeError', 'SyntaxError', 'AbortError', 'RangeError', 'ReferenceError'])

// Text that only a database, the network stack or a parser produces.
const RAW_TEXT = [
  /\bfetch\b/i,
  /\bJSON\b/,
  /\bnetwork ?error\b/i,
  /\bPGRST\d+/,
  /\bviolates\b.*\bconstraint\b/i,
  /\bduplicate key\b/i,
  /\b(relation|column|function) "?[\w.]+"? does not exist\b/i,
  /\bpermission denied for\b/i,
  /\brow-level security\b/i,
  /\bat [\w.<>]+ \(.*:\d+:\d+\)/, // a stack frame
]

export function isUserFacingMessage(message: string): boolean {
  const text = message.trim()
  if (!text || text.length > 400) return false
  return !RAW_TEXT.some(re => re.test(text))
}

export function userMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback
  if (RUNTIME_ERRORS.has(err.name)) return fallback
  return isUserFacingMessage(err.message) ? err.message : fallback
}
