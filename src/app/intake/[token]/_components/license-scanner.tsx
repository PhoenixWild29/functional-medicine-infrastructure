'use client'

// ============================================================
// License barcode scanner (Patient Intake PR 2)
// ============================================================
//
// Reads the PDF417 barcode on the back of a driver's license with the
// phone's camera, on the phone. Nothing is uploaded: no frame leaves the
// browser, and only the decoded text is handed back (the intake form then
// keeps the fields it needs). The camera stops as soon as a barcode is
// read, on Stop scanning, and when this unmounts.
//
// The browser's own BarcodeDetector is used where it exists (Chrome on
// Android); elsewhere (Safari on iPhone) ZXing, bundled with the app and
// loaded only when the patient taps Scan. Camera access is allowed only on
// /intake (Permissions-Policy, src/lib/security/headers.ts).

import { useEffect, useRef, useState } from 'react'

interface Props {
  onScanned: (text: string) => void
  onCancel: () => void
}

type Detector = { detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue: string }>> }
type DetectorCtor = {
  new (opts: { formats: string[] }): Detector
  getSupportedFormats?: () => Promise<string[]>
}

export function LicenseScanner({ onScanned, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'starting' | 'scanning' | 'error'>('starting')
  const [message, setMessage] = useState('Starting the camera…')

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let frame = 0
    let zxingControls: { stop: () => void } | null = null

    const stopAll = () => {
      stopped = true
      if (frame) cancelAnimationFrame(frame)
      zxingControls?.stop()
      stream?.getTracks().forEach(t => t.stop())
    }
    const done = (text: string) => {
      if (stopped) return
      stopAll()
      onScanned(text)
    }

    ;(async () => {
      const video = videoRef.current
      if (!video) return
      try {
        const Ctor = (globalThis as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector
        const native = Ctor && (await Ctor.getSupportedFormats?.())?.includes('pdf417')
        if (Ctor && native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
          if (stopped) { stream.getTracks().forEach(t => t.stop()); return }
          video.srcObject = stream
          await video.play()
          const detector = new Ctor({ formats: ['pdf417'] })
          setStatus('scanning')
          setMessage('Hold the back of your license in the frame, about 6 inches away.')
          const tick = async () => {
            if (stopped) return
            try {
              const codes = await detector.detect(video)
              const text = codes[0]?.rawValue
              if (text) return done(text)
            } catch {
              // A frame that cannot be read; try the next one.
            }
            frame = requestAnimationFrame(() => { void tick() })
          }
          void tick()
          return
        }

        const { BrowserPDF417Reader } = await import('@zxing/browser')
        if (stopped) return
        const reader = new BrowserPDF417Reader()
        setStatus('scanning')
        setMessage('Hold the back of your license in the frame, about 6 inches away.')
        zxingControls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' }, audio: false },
          video,
          result => { if (result) done(result.getText()) },
        )
        if (stopped) zxingControls.stop()
      } catch (err) {
        if (stopped) return
        const name = (err as { name?: string })?.name
        setStatus('error')
        setMessage(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? 'Camera access was not allowed. You can type your details instead.'
            : 'The camera could not be started on this phone. You can type your details instead.',
        )
      }
    })()

    return stopAll
  }, [onScanned])

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-slate-500 bg-black">
        {/* The live camera view; nothing is recorded. */}
        <video ref={videoRef} muted playsInline aria-label="Camera view for scanning your license" className="aspect-[4/3] w-full object-cover" />
      </div>
      <p role={status === 'error' ? 'alert' : 'status'} className={`text-sm ${status === 'error' ? 'text-red-700' : 'text-foreground'}`}>
        {message}
      </p>
      <button
        type="button"
        onClick={onCancel}
        className="min-h-[44px] w-full rounded-lg border border-slate-500 px-4 py-2 text-base font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        Stop scanning
      </button>
    </div>
  )
}
