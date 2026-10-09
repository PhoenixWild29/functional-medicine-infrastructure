// PUT  /api/pharmacy/onboarding/{details|facility|ordering|shipping|catalog}: save a step
// POST /api/pharmacy/onboarding/{agreement|submit}: accept the BAA and terms; submit
// The pharmacy is the caller's claim (pharmacyAdmin), never a body field.
import type { NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { saveDetails, saveFacility, saveOrdering, saveShipping, saveCatalog, acceptAgreement, submitApplication } from '@/lib/pharmacy-onboarding/application'
import { bodyOf, crossSiteRefusal, json, pharmacyAdmin, respond } from '@/lib/pharmacy-onboarding/request'

export const dynamic = 'force-dynamic'

type Context = { params: Promise<{ step: string }> }

const PUT_STEPS = { details: saveDetails, facility: saveFacility, ordering: saveOrdering, shipping: saveShipping, catalog: saveCatalog } as const

export async function PUT(request: NextRequest, context: Context) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const { step } = await context.params
  const save = PUT_STEPS[step as keyof typeof PUT_STEPS]
  if (!save) return json({ error: 'Not found' }, 404)
  const who = await pharmacyAdmin()
  if (!who.ok) return who.response
  return respond(await save(createServiceClient(), who.ctx, await bodyOf(request)))
}

export async function POST(request: NextRequest, context: Context) {
  const refused = crossSiteRefusal(request)
  if (refused) return refused
  const { step } = await context.params
  if (step !== 'agreement' && step !== 'submit') return json({ error: 'Not found' }, 404)
  const who = await pharmacyAdmin()
  if (!who.ok) return who.response
  const db = createServiceClient()
  return respond(step === 'agreement'
    ? await acceptAgreement(db, who.ctx, await bodyOf(request))
    : await submitApplication(db, who.ctx))
}
