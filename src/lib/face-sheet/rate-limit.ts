// Rate limit for POST /api/patients/face-sheet: 20 reads an hour per signed-in
// user, counted across every server instance (lib/security/shared-rate-limit). Kept outside the route module because a
// Next.js route file may only export its handlers; tests reset it.

import { createSharedRateLimiter } from '@/lib/security/shared-rate-limit'

export const FACE_SHEET_LIMIT = 20
export const FACE_SHEET_WINDOW_MS = 60 * 60 * 1000

export const faceSheetLimiter = createSharedRateLimiter({ bucket: 'face_sheet', limit: FACE_SHEET_LIMIT, windowMs: FACE_SHEET_WINDOW_MS })

export const FACE_SHEET_RATE_LIMITED_MESSAGE = 'You have read 20 face sheets in the last hour. Wait a while, or enter the details by hand.'
