// ============================================================
// The request body limit for anything uploaded through a Vercel Function
// ============================================================
//
// Vercel refuses request bodies over about 4.5 MB before the function
// runs, so every upload, and every request that carries a file's contents
// (CSV rows re-posted as JSON), is limited to 4 MB: checked on the server
// where the server sees the file, in the browser before anything is sent,
// and named in the copy ("up to 4 MB"). The face sheet set the pattern
// (lib/face-sheet/config). Plain module: used in the browser and the server.

export const MAX_REQUEST_BYTES = 4 * 1024 * 1024
export const MAX_REQUEST_LABEL = '4 MB'

/** True when this JSON body would be over the 4 MB limit (measured in bytes). */
export function jsonBodyTooLarge(body: unknown): boolean {
  return new TextEncoder().encode(JSON.stringify(body)).length > MAX_REQUEST_BYTES
}
