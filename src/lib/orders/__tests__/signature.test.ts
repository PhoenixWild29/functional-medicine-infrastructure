/**
 * WO-99: what counts as a signature — at least 3 strokes spanning at least
 * 40% of the pad — replacing the 5,000-character data-URL heuristic, which
 * measured the PNG encoding, not the signature.
 */

import { checkSignature, signatureFromPad, MIN_SIGNATURE_STROKES } from '../signature'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const stroke = (x1: number, x2: number, y = 20) => [{ x: x1, y }, { x: (x1 + x2) / 2, y: y + 3 }, { x: x2, y }]

describe('checkSignature', () => {
  it('a small but real signature — 3 strokes across 40% of the pad — is accepted', () => {
    const res = checkSignature({ dataUrl: PNG, strokes: [stroke(60, 120), stroke(100, 140, 40), stroke(130, 180, 60)], padWidth: 300 })
    expect(res.ok).toBe(true)
  })

  it('a single dot is rejected', () => {
    expect(checkSignature({ dataUrl: PNG, strokes: [[{ x: 150, y: 50 }]], padWidth: 300 })).toEqual({ ok: false, reason: 'too_few_strokes' })
  })

  it(`fewer than ${MIN_SIGNATURE_STROKES} strokes is rejected however wide`, () => {
    expect(checkSignature({ dataUrl: PNG, strokes: [stroke(0, 300), stroke(0, 300, 40)], padWidth: 300 })).toEqual({ ok: false, reason: 'too_few_strokes' })
  })

  it('three strokes bunched in a corner are rejected', () => {
    expect(checkSignature({ dataUrl: PNG, strokes: [stroke(10, 40), stroke(20, 50), stroke(30, 60)], padWidth: 300 })).toEqual({ ok: false, reason: 'too_narrow' })
  })

  it('empty strokes do not count toward the three', () => {
    expect(checkSignature({ dataUrl: PNG, strokes: [stroke(0, 200), [], [], stroke(10, 250)], padWidth: 300 })).toEqual({ ok: false, reason: 'too_few_strokes' })
  })

  it.each([
    ['no payload', null],
    ['not a PNG', { dataUrl: 'data:image/jpeg;base64,x', strokes: [stroke(0, 200), stroke(0, 200), stroke(0, 200)], padWidth: 300 }],
    ['an empty PNG', { dataUrl: 'data:image/png;base64,', strokes: [stroke(0, 200), stroke(0, 200), stroke(0, 200)], padWidth: 300 }],
    ['no pad width', { dataUrl: PNG, strokes: [stroke(0, 200), stroke(0, 200), stroke(0, 200)], padWidth: 0 }],
    ['points that are not numbers', { dataUrl: PNG, strokes: [[{ x: 'a', y: 1 }]], padWidth: 300 }],
    ['the old body (a data URL alone)', { signatureDataUrl: PNG + 'A'.repeat(6000) }],
  ])('%s is rejected as malformed', (_label, raw) => {
    expect(checkSignature(raw)).toEqual({ ok: false, reason: 'format' })
  })
})

describe('signatureFromPad', () => {
  it('reads signature_pad 2.x point groups and the pad CSS width', () => {
    const pad = {
      toDataURL: () => PNG,
      toData:    () => [[{ x: 1, y: 2, time: 1, color: 'black' }], [{ x: 3, y: 4, time: 2, color: 'black' }]],
      getCanvas: () => ({ getBoundingClientRect: () => ({ width: 320 }) }),
    }
    expect(signatureFromPad(pad)).toEqual({ dataUrl: PNG, strokes: [[{ x: 1, y: 2 }], [{ x: 3, y: 4 }]], padWidth: 320 })
  })

  it('no pad → null', () => {
    expect(signatureFromPad(null)).toBeNull()
  })
})
