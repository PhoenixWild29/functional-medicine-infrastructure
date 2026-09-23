/**
 * @jest-environment node
 *
 * WO-99: sign-and-send no longer signs. It never checked the EPCS code
 * (that lived only in the browser), so a controlled order could be signed
 * by POSTing here directly. Signing is POST /api/orders/batch-sign only.
 */

import { POST } from '../route'

const fromMock = jest.fn()
jest.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ from: fromMock }) }))

describe('POST /api/orders/[orderId]/sign-and-send', () => {
  it('refuses with 410 and reads or writes nothing', async () => {
    const res = await POST()
    expect(res.status).toBe(410)
    expect(await res.json()).toMatchObject({ code: 'USE_BATCH_SIGN' })
    expect(fromMock).not.toHaveBeenCalled()
  })
})
