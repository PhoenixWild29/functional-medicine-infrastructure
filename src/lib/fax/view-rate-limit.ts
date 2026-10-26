// Rate limit for GET /api/ops/fax/[faxId]/pdf: 60 fax views per 10 minutes
// per signed-in ops user (lib/security/rate-limit). Kept outside the route
// module because a Next.js route file may only export its handlers; tests
// reset it.

import { createRateLimiter } from '@/lib/security/rate-limit'

export const FAX_VIEW_LIMIT = 60
export const FAX_VIEW_WINDOW_MS = 10 * 60 * 1000

export const faxViewLimiter = createRateLimiter({ limit: FAX_VIEW_LIMIT, windowMs: FAX_VIEW_WINDOW_MS })
