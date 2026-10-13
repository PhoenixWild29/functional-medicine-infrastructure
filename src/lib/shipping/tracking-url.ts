// ============================================================
// Carrier tracking link from carrier + tracking number
// ============================================================
//
// orders stores tracking_number and carrier (free text, set by ops or the
// pharmacy webhook); there is no stored tracking URL. This builds the
// carrier's public tracking page for the carriers we know, and returns
// null otherwise (an unknown carrier, no number, or a number that is not
// a plain tracking token), so the caller can send without a link.

const TRACKING_PAGES: Record<string, (n: string) => string> = {
  ups:   n => `https://www.ups.com/track?tracknum=${n}`,
  fedex: n => `https://www.fedex.com/fedextrack/?trknbr=${n}`,
  usps:  n => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`,
  dhl:   n => `https://www.dhl.com/us-en/home/tracking/tracking-express.html?submit=1&tracking-id=${n}`,
}

// Letters and digits only (carriers' numbers are alphanumeric), 4 to 40.
const TRACKING_NUMBER = /^[A-Za-z0-9]{4,40}$/

/** "UPS", "Fed Ex", " usps " → the key in TRACKING_PAGES. */
function carrierKey(carrier: string): string {
  return carrier.toLowerCase().replace(/[^a-z]/g, '')
}

export function carrierTrackingUrl(carrier: string | null | undefined, trackingNumber: string | null | undefined): string | null {
  if (!carrier || !trackingNumber) return null
  const number = trackingNumber.trim()
  if (!TRACKING_NUMBER.test(number)) return null
  const page = TRACKING_PAGES[carrierKey(carrier)]
  return page ? page(encodeURIComponent(number)) : null
}
