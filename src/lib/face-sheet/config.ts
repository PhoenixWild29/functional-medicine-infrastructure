// ============================================================
// Face-sheet fill: on, off, or not set up (Patient Intake PR 4)
// ============================================================
//
// FACE_SHEET_AI_ENABLED: on unless set to "false" (the route answers 404).
// ANTHROPIC_API_KEY: without it (or blank) the route answers 503 "not set
// up" and makes no Anthropic call. The entry point is shown only when both
// allow it (faceSheetAvailable); otherwise it is not rendered at all.
// Server only (reads the environment); the page passes only the boolean.

export type FaceSheetStatus = 'ready' | 'not_configured' | 'off'

export const FACE_SHEET_NOT_SET_UP = 'Face sheet fill is not set up.'
/**
 * The largest face sheet accepted (also checked in the browser before
 * upload). 4 MB: Vercel refuses request bodies over about 4.5 MB.
 */
export const MAX_FACE_SHEET_BYTES = 4 * 1024 * 1024

/** True only when the flag is not "false" and a key is set. The one thing the client is told. */
export function faceSheetAvailable(): boolean {
  return faceSheetStatus() === 'ready'
}

export function faceSheetStatus(): FaceSheetStatus {
  if (process.env['FACE_SHEET_AI_ENABLED']?.trim().toLowerCase() === 'false') return 'off'
  if (!process.env['ANTHROPIC_API_KEY']?.trim()) return 'not_configured'
  return 'ready'
}
