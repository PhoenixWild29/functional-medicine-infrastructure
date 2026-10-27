// Length bounds for a saved clinical difference statement. No imports
// beyond rx-details, so the Review row (a client component) can use them
// without pulling the server's input helpers into the browser bundle.

import { MIN_OTHER_REASON_LENGTH } from '@/lib/orders/rx-details'

/** The same minimum as a typed "Other (describe)" reason. */
export const SAVED_STATEMENT_MIN = MIN_OTHER_REASON_LENGTH
/** The same maximum rxDetails.clinicalDifference accepts. */
export const SAVED_STATEMENT_MAX = 500
