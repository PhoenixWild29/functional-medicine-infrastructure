// What an uploaded file is, from its first bytes: never its name or the
// type the browser declared. PDF, PNG and JPEG are the only document types
// the app accepts (face sheets, pharmacy license documents).

export type SniffedDocumentType = 'application/pdf' | 'image/png' | 'image/jpeg'

export function sniffDocumentType(bytes: Uint8Array): SniffedDocumentType | null {
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d) return 'application/pdf'
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return null
}
