'use client'

// A QR code drawn in the browser (Patient Intake PR 3): the qrcode package
// encodes the text here, and the dark modules are one SVG path, a run of
// modules per row segment (one rect per module put ~570 nodes on the page
// for a sign-up link). No image is fetched and no third-party service sees
// the link. Always dark on white, with a quiet zone, so phones read it in
// dark mode and on paper.

import { useMemo } from 'react'
import QRCode from 'qrcode'

const QUIET = 4

export function QrCode({ text, label, className = '' }: { text: string; label: string; className?: string }) {
  const { size, d } = useMemo(() => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' })
    let path = ''
    for (let r = 0; r < modules.size; r++) {
      for (let c = 0; c < modules.size; c++) {
        if (!modules.get(r, c)) continue
        let w = 1
        while (c + w < modules.size && modules.get(r, c + w)) w++
        path += `M${c + QUIET} ${r + QUIET}h${w}v1h-${w}z`
        c += w - 1
      }
    }
    return { size: modules.size, d: path }
  }, [text])

  const box = size + QUIET * 2
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" className={className}>
      <rect width={box} height={box} fill="#ffffff" />
      <path d={d} fill="#000000" />
    </svg>
  )
}
