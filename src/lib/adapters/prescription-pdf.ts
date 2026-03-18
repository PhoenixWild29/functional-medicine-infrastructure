// ============================================================
// Prescription PDF Generator — WO-22
// ============================================================
//
// Builds a valid PDF/1.4 document from an order snapshot for
// transmission via Documo mFax (Tier 4 fallback).
//
// No external PDF library required — generates raw PDF syntax.
// All output is ASCII-safe: non-printable chars are replaced
// with a space so byte-count === char-count throughout.
//
// Output: Uint8Array of PDF bytes, suitable for Supabase Storage
// upload and subsequent Documo documentUrl delivery.
//
// HIPAA: Uses "Compounded Medication Service" generic language.
// PHI (patient name, DOB, address) is present because this is
// the prescription document itself — Documo is BAA-covered.

// ============================================================
// TYPES
// ============================================================

export interface PrescriptionPdfData {
  // Prescriber (from provider row + provider_npi_snapshot)
  providerFirstName: string
  providerLastName: string
  providerNpi: string
  providerDea: string | null
  providerLicenseState: string
  // Patient (from patient row)
  patientFirstName: string
  patientLastName: string
  patientDateOfBirth: string   // ISO date string (YYYY-MM-DD)
  patientAddressLine1: string | null
  patientAddressLine2: string | null
  patientCity: string | null
  patientState: string | null
  patientZip: string | null
  // Medication (from medication_snapshot JSONB)
  medicationName: string
  medicationForm: string
  medicationDose: string
  quantity: number
  sigText: string | null       // directions
  // Order metadata
  orderNumber: string | null
  orderDate: string            // ISO date string
  clinicName: string
  // Recipient
  pharmacyName: string
}

// ============================================================
// PDF STRING ESCAPING
// ============================================================
// Replace non-printable ASCII with space, then escape PDF
// special chars: backslash, open-paren, close-paren.
// Result is guaranteed ASCII-only (safe for byte offset math).

function esc(s: string): string {
  return s
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

// ============================================================
// CONTENT STREAM BUILDER
// ============================================================
// Produces the BT...ET text block that renders the prescription
// onto a single Letter-size page (612 x 792 pt).
// F1 = Helvetica (body), F2 = Helvetica-Bold (headers/labels)

function buildContentStream(d: PrescriptionPdfData): string {
  // Normalize dates for display
  const parseDate = (s: string) => {
    try {
      return new Date(s).toLocaleDateString('en-US', { timeZone: 'UTC' })
    } catch {
      return s
    }
  }

  type TextLine = {
    text: string
    font: 'F1' | 'F2'
    size: number
    dy: number          // vertical delta (negative = move down)
  }

  const lines: TextLine[] = []
  const h  = (text: string): TextLine => ({ text, font: 'F2', size: 10, dy: -16 })
  const v  = (text: string): TextLine => ({ text, font: 'F1', size: 9,  dy: -14 })
  const sp = (dy: number)  : TextLine => ({ text: '',  font: 'F1', size: 9,  dy })
  const ft = (text: string): TextLine => ({ text, font: 'F1', size: 8,  dy: -12 })

  // ── Header ────────────────────────────────────────────────
  lines.push({ text: 'COMPOUNDED MEDICATION PRESCRIPTION', font: 'F2', size: 14, dy: 0 })
  lines.push({ text: 'Compounded Medication Service - HIPAA Protected Document', font: 'F1', size: 9, dy: -18 })
  lines.push(v(`Date: ${parseDate(d.orderDate)}${d.orderNumber ? `    Order #: ${d.orderNumber}` : ''}`))
  lines.push(sp(-10))

  // ── Prescriber ────────────────────────────────────────────
  lines.push(h('PRESCRIBER'))
  lines.push(v(`Dr. ${d.providerFirstName} ${d.providerLastName}`))
  lines.push(v(`NPI: ${d.providerNpi}    License State: ${d.providerLicenseState}`))
  if (d.providerDea) {
    lines.push(v(`DEA: ${d.providerDea}`))
  }
  lines.push(sp(-10))

  // ── Patient ───────────────────────────────────────────────
  lines.push(h('PATIENT'))
  lines.push(v(`${d.patientLastName}, ${d.patientFirstName}`))
  lines.push(v(`DOB: ${parseDate(d.patientDateOfBirth)}`))
  const addrParts = [
    d.patientAddressLine1,
    d.patientAddressLine2,
    d.patientCity,
    d.patientState,
    d.patientZip,
  ].filter(Boolean)
  if (addrParts.length > 0) {
    lines.push(v(`Address: ${addrParts.join(', ')}`))
  }
  lines.push(sp(-10))

  // ── Medication ────────────────────────────────────────────
  lines.push(h('MEDICATION ORDER'))
  lines.push(v(`Medication: ${d.medicationName}`))
  lines.push(v(`Form: ${d.medicationForm}    Dose: ${d.medicationDose}`))
  lines.push(v(`Quantity: ${d.quantity}`))
  if (d.sigText) {
    lines.push(v(`Sig: ${d.sigText}`))
  }
  lines.push(sp(-10))

  // ── Clinic ────────────────────────────────────────────────
  lines.push(h('ORIGINATING CLINIC'))
  lines.push(v(d.clinicName))
  lines.push(sp(-20))

  // ── Footer ────────────────────────────────────────────────
  lines.push(ft('CONFIDENTIAL - This transmission contains HIPAA-protected health information.'))
  lines.push(ft(`Intended recipient: ${d.pharmacyName}`))
  lines.push(ft('If received in error, please destroy immediately and notify the sender.'))

  // ── Render PDF operators ──────────────────────────────────
  const ops: string[] = ['BT']
  let firstLine = true

  for (const line of lines) {
    ops.push(`/${line.font} ${line.size} Tf`)

    if (firstLine) {
      ops.push('72 720 Td')
      firstLine = false
    } else if (line.dy !== 0) {
      ops.push(`0 ${line.dy} Td`)
    }

    if (line.text) {
      ops.push(`(${esc(line.text)}) Tj`)
    }
  }

  ops.push('ET')
  return ops.join('\n')
}

// ============================================================
// PDF DOCUMENT ASSEMBLER
// ============================================================
// Builds a complete PDF/1.4 document with:
//   Object 1: Catalog
//   Object 2: Pages dictionary
//   Object 3: Page (Letter, 612 x 792)
//   Object 4: Content stream
//   Object 5: Font F1 — Helvetica
//   Object 6: Font F2 — Helvetica-Bold
// Includes proper cross-reference table and trailer.

export function buildPrescriptionPdfBytes(data: PrescriptionPdfData): Uint8Array {
  const contentStream = buildContentStream(data)
  // All content stream chars are ASCII (esc() guarantees this),
  // so contentStream.length === byte count — safe for /Length.
  const csLen = contentStream.length

  const parts: string[] = []
  // offsets[i] = byte offset of object i in the file
  const offsets: number[] = new Array(7).fill(0)
  let pos = 0

  const add = (s: string) => {
    parts.push(s)
    pos += s.length   // valid: all structural PDF strings are ASCII
  }

  // PDF header
  add('%PDF-1.4\n')

  // Object 1 — Catalog
  offsets[1] = pos
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')

  // Object 2 — Pages
  offsets[2] = pos
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')

  // Object 3 — Page (Letter)
  offsets[3] = pos
  add(
    '3 0 obj\n' +
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]' +
    ' /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>\n' +
    'endobj\n'
  )

  // Object 4 — Content stream
  offsets[4] = pos
  add(`4 0 obj\n<< /Length ${csLen} >>\nstream\n`)
  add(contentStream)
  add('\nendstream\nendobj\n')

  // Object 5 — Font: Helvetica (body)
  offsets[5] = pos
  add('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n')

  // Object 6 — Font: Helvetica-Bold (headers)
  offsets[6] = pos
  add('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n')

  // Cross-reference table
  const xrefPos = pos
  add('xref\n0 7\n')
  add('0000000000 65535 f \n')
  for (let i = 1; i <= 6; i++) {
    add(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  }

  // Trailer
  add(`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)

  return new TextEncoder().encode(parts.join(''))
}
