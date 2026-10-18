'use client'

// A QR code drawn in the browser (Patient Intake PR 3): the qrcode package
// encodes the text here, and each dark module is an SVG rect. No image is
// fetched and no third-party service sees the link. Always dark on white,
// with a quiet zone, so phones read it in dark mode and on paper.

import { useMemo } from 'react'
import QRCode from 'qrcode'

const QUIET = 4

export function QrCode({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const { size, cells } = useMemo(() => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
    const out: Array<[number, number]> = []
    for (let r = 0; r < modules.size; r++) {
      for (let c = 0; c < modules.size; c++) if (modules.get(r, c)) out.push([c, r])
    }
    return { size: modules.size, cells: out }
  }, [text])

  const box = size + QUIET * 2
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" className={className}>
      <rect width={box} height={box} fill="#ffffff" />
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x + QUIET} y={y + QUIET} width={1} height={1} fill="#000000" />)}
    </svg>
  )
}
