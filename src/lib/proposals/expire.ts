// ============================================================
// Proposal expiry (patient protocol choice, PR 4)
// ============================================================
//
// GET /api/cron/proposal-expiry runs this. A proposal sent, or chosen but
// never signed, whose link is past expires_at (7 days from sending,
// decision 5) expires:
//   - status expired (compare-and-set on the status it was read with),
//     token_hash NULL (the link dies);
//   - its DRAFT lines go DRAFT -> CANCELLED (never signed), with history;
//   - 'expired' is recorded (actor system).
// Safe to run again: an expired proposal is never read again, and every
// write is conditional. A read that fails throws (the cron answers 500),
// never "nothing expired".

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { insertStatusHistory } from '@/lib/orders/status-history'

type Db = SupabaseClient<Database>

export const PROPOSAL_EXPIRY_BATCH = 100

export async function expireProposals(db: Db, now: Date, limit: number = PROPOSAL_EXPIRY_BATCH):
  Promise<{ expired: number; cancelledOrders: number; failed: number }> {
  const { data, error } = await db.from('treatment_proposals')
    .select('proposal_id, status')
    .in('status', ['sent', 'chosen'])
    .lt('expires_at', now.toISOString())
    .order('expires_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`[proposal-expiry] proposals could not be read: ${error.message}`)

  let expired = 0
  let cancelledOrders = 0
  let failed = 0
  for (const p of (data ?? []) as Array<{ proposal_id: string; status: string }>) {
    const { data: closed, error: closeError } = await db.from('treatment_proposals')
      .update({ status: 'expired', token_hash: null })
      .eq('proposal_id', p.proposal_id)
      .eq('status', p.status)
      .select('proposal_id')
    if (closeError) {
      console.error('[proposal-expiry] could not expire:', closeError.message, '| proposal=', p.proposal_id)
      failed++
      continue
    }
    // Chosen or signed in the meantime: not this run's to expire.
    if (((closed ?? []) as unknown[]).length === 0) continue
    expired++

    const { data: options, error: optionsError } = await db.from('treatment_proposal_options').select('option_id').eq('proposal_id', p.proposal_id)
    const optionIds = ((options ?? []) as Array<{ option_id: string }>).map(o => o.option_id)
    if (optionsError) {
      console.error('[proposal-expiry] options could not be read:', optionsError.message, '| proposal=', p.proposal_id)
      failed++
    } else if (optionIds.length > 0) {
      const { data: cancelled, error: cancelError } = await db.from('orders')
        .update({ status: 'CANCELLED' })
        .in('proposal_option_id', optionIds)
        .eq('status', 'DRAFT')
        .select('order_id')
      if (cancelError) {
        console.error('[proposal-expiry] lines could not be cancelled:', cancelError.message, '| proposal=', p.proposal_id)
        failed++
      } else {
        const ids = ((cancelled ?? []) as Array<{ order_id: string }>).map(o => o.order_id)
        cancelledOrders += ids.length
        await insertStatusHistory(db, ids.map(order_id => ({
          order_id, old_status: 'DRAFT' as const, new_status: 'CANCELLED' as const, changed_by: 'system',
          metadata: { reason: 'proposal_expired', proposal_id: p.proposal_id },
        })), 'proposal-expiry')
      }
    }

    const { error: eventError } = await db.from('treatment_proposal_events').insert({
      proposal_id: p.proposal_id, event: 'expired', actor: 'system', actor_user_id: null,
    })
    if (eventError) console.error('[proposal-expiry] expired event not recorded:', eventError.message, '| proposal=', p.proposal_id)
  }

  console.info(`[proposal-expiry] expired=${expired} | cancelled orders=${cancelledOrders} | failed=${failed}`)
  return { expired, cancelledOrders, failed }
}
