// ============================================================
// Face-sheet fill: on, off, or not set up (Patient Intake PR 4)
// ============================================================
//
// FACE_SHEET_AI_ENABLED: on unless set to "false" (the entry point is then
// hidden and the route answers 404). ANTHROPIC_API_KEY: without it the
// entry point says "Face sheet fill is not set up" and manual entry stays.
// Server only (reads the environment); the page passes the status down.

export type FaceSheetStatus = 'ready' | 'not_configured' | 'off'

export const FACE_SHEET_NOT_SET_UP = 'Face sheet fill is not set up.'
/** The largest face sheet accepted (also checked in the browser before upload). */
export const MAX_FACE_SHEET_BYTES = 10 * 1024 * 1024

export function faceSheetStatus(): FaceSheetStatus {
  if (process.env['FACE_SHEET_AI_ENABLED']?.trim().toLowerCase() === 'false') return 'off'
  if (!process.env['ANTHROPIC_API_KEY']?.trim()) return 'not_configured'
  return 'ready'
}
