// ============================================================
// Provider signature — what counts as signed (WO-99)
// ============================================================
//
// The old rule was a PNG data URL of at least 5,000 characters. That
// measured the canvas encoding, not the signature: a blank pad can come
// close, and a small but real signature on a sparse pad can fall short.
//
// WO-99's rule is about the strokes themselves:
//   - at least 3 strokes (a single dot, or one accidental swipe, is not a
//     signature), and
//   - they span at least 40% of the pad's width.
//
// The same function runs on the client (to enable Sign & Send) and on the
// server (the gate that counts). Strokes are the signature_pad point
// groups, in the pad's CSS pixels; padWidth is the pad's CSS width.

export interface SignaturePoint { x: number; y: number }

export interface SignaturePayload {
  /** PNG capture of the pad — what is hashed into the signature record. */
  dataUrl:  string
  /** signature_pad's toData(): one array of points per stroke. */
  strokes:  SignaturePoint[][]
  /** The pad's width in the same (CSS pixel) units as the points. */
  padWidth: number
}

export const MIN_SIGNATURE_STROKES        = 3
export const MIN_SIGNATURE_WIDTH_FRACTION = 0.4

export type SignatureRejection = 'format' | 'too_few_strokes' | 'too_narrow'

export type SignatureCheck =
  | { ok: true; signature: SignaturePayload }
  | { ok: false; reason: SignatureRejection }

export const SIGNATURE_REJECTION_COPY: Record<SignatureRejection, string> = {
  format:          'A valid provider signature is required.',
  too_few_strokes: `Sign with at least ${MIN_SIGNATURE_STROKES} strokes — a dot or a single line is not a signature.`,
  too_narrow:      `Sign across the pad — the signature must span at least ${Math.round(MIN_SIGNATURE_WIDTH_FRACTION * 100)}% of its width.`,
}

function isPoint(p: unknown): p is SignaturePoint {
  return !!p && typeof p === 'object'
    && Number.isFinite((p as SignaturePoint).x)
    && Number.isFinite((p as SignaturePoint).y)
}

/** Validate an untrusted signature payload against the stroke rule. */
export function checkSignature(raw: unknown): SignatureCheck {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'format' }
  const { dataUrl, strokes, padWidth } = raw as Partial<SignaturePayload>

  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,') || dataUrl.length <= 'data:image/png;base64,'.length) {
    return { ok: false, reason: 'format' }
  }
  if (typeof padWidth !== 'number' || !Number.isFinite(padWidth) || padWidth <= 0) {
    return { ok: false, reason: 'format' }
  }
  if (!Array.isArray(strokes) || !strokes.every(s => Array.isArray(s) && s.every(isPoint))) {
    return { ok: false, reason: 'format' }
  }

  const drawn = strokes.filter(s => s.length > 0)
  if (drawn.length < MIN_SIGNATURE_STROKES) return { ok: false, reason: 'too_few_strokes' }

  const xs = drawn.flat().map(p => p.x)
  const span = Math.max(...xs) - Math.min(...xs)
  if (span < MIN_SIGNATURE_WIDTH_FRACTION * padWidth) return { ok: false, reason: 'too_narrow' }

  return { ok: true, signature: { dataUrl, strokes: drawn, padWidth } }
}

/**
 * Read the payload off a react-signature-canvas ref. signature_pad 2.x
 * stores each stroke as an array of { x, y, time, color } in CSS pixels
 * relative to the canvas; the canvas' CSS width is the matching padWidth.
 */
export function signatureFromPad(pad: {
  toDataURL: (type?: string) => string
  toData: () => unknown
  getCanvas: () => { getBoundingClientRect: () => { width: number } }
} | null | undefined): SignaturePayload | null {
  if (!pad) return null
  const data = pad.toData()
  const strokes = Array.isArray(data)
    ? data.map(group => (Array.isArray(group) ? group : []).filter(isPoint).map(p => ({ x: p.x, y: p.y })))
    : []
  return {
    dataUrl:  pad.toDataURL('image/png'),
    strokes,
    padWidth: pad.getCanvas().getBoundingClientRect().width,
  }
}
