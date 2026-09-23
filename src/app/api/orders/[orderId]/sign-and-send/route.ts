// ============================================================
// Sign & Send — retired by WO-99
// POST /api/orders/[orderId]/sign-and-send
// ============================================================
//
// This route used to sign one order. It never checked the EPCS
// authenticator code (that lived only in the browser), so a Schedule 3
// order could be signed by POSTing here directly. WO-99 makes
// POST /api/orders/batch-sign the only signing path: it checks every line,
// verifies the code in the same request when any line is controlled, and
// signs a patient's orders together behind one payment link.
//
// It refuses rather than forwards: a caller still posting here is sending
// the old body (no strokes, no code), and a forward would only turn that
// into a confusing 400. Nothing is read or written.

import { NextResponse } from 'next/server'

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: 'Signing moved: sign through the batch sign page (POST /api/orders/batch-sign). Nothing was signed.',
      code:  'USE_BATCH_SIGN',
    },
    { status: 410 },
  )
}
