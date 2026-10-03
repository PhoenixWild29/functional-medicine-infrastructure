/**
 * @jest-environment node
 *
 * no-unchecked-supabase-error (Batch 3).
 *
 * Batches 1 and 2 (#164–#170) fixed the clinical and money paths where a
 * Supabase call's `.error` was ignored and the code carried on with
 * `data = null` as if the read or write had succeeded. This rule makes the
 * pattern impossible to add again: an awaited Supabase query or RPC
 * (`.from(…)`, `.rpc(…)`, `.storage…`, `.auth.admin…`) whose `error` is
 * never read is an error.
 *
 * Accepted: the error is read (checked, thrown, returned, logged), or the
 * line above carries `// supabase-error-ok: <reason>` with a reason.
 * Existing sites are listed in a baseline (file + function + line text)
 * and skipped; anything new fails.
 */

import { RuleTester } from 'eslint'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsParser = require('@typescript-eslint/parser')
import rule from '../no-unchecked-supabase-error'

const tester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
})

const ROUTE = `${process.cwd()}/src/app/api/orders/route.ts`.replace(/\\/g, '/')

const wrap = (body: string) => `export async function GET(supabase: any, id: string, rows: any[]) {\n${body}\n}`

tester.run('no-unchecked-supabase-error', rule, {
  valid: [
    // 1. Checked and thrown.
    { code: wrap(`const { data, error } = await supabase.from('orders').select('*')\nif (error) throw error\nreturn data`) },
    // 2. Checked, error response returned.
    { code: wrap(`const { data, error } = await supabase.from('orders').select('*')\nif (error) return NextResponse.json({ error: 'Could not load orders' }, { status: 500 })\nreturn NextResponse.json(data)`) },
    // 3. Checked, logged, returned.
    { code: wrap(`const { data, error } = await supabase.from('orders').select('*')\nif (error) { console.error('[orders]', error.message); return null }\nreturn data`) },
    // 4. Renamed error binding.
    { code: wrap(`const { data, error: readError } = await supabase.from('orders').select('*').eq('id', id)\nif (readError) throw readError\nreturn data`) },
    // 5. Whole result: error read before data.
    { code: wrap(`const res = await supabase.from('orders').select('*')\nif (res.error) throw res.error\nreturn res.data`) },
    // 6. Explicit, reasoned exception.
    { code: wrap(`// supabase-error-ok: best-effort audit row; the order write above already succeeded\nawait supabase.from('order_status_history').insert({ order_id: id })`) },
    // 7. A write that only destructures error, and checks it.
    { code: wrap(`const { error } = await supabase.from('orders').update({ status: 'X' }).eq('order_id', id)\nif (error) throw new Error(error.message)`) },
    // 8. Not awaited: the promise goes to the caller, who must check it.
    { code: wrap(`return supabase.from('orders').select('*')`) },
    // 9. Not Supabase.
    { code: wrap(`const list = await Array.from(rows)\nreturn list`) },
    // 10. The whole result is handed on — the receiver decides.
    { code: wrap(`const res = await supabase.rpc('count_orders', { id })\nreturn res`) },
    // 11. A multi-line statement: the comment sits above its first line.
    { code: wrap(`// supabase-error-ok: cache warm-up, a miss only costs a slower first page\nawait supabase\n  .from('cache')\n  .upsert({ id })`) },
    // 12. Promise.all, every element checked.
    { code: wrap(`const [a, b] = await Promise.all([supabase.from('a').select(), supabase.from('b').select()])\nif (a.error || b.error) throw new Error('read failed')\nreturn [a.data, b.data]`) },
    // 13. Baseline: an exact match (file + function + line text) is skipped.
    {
      code: wrap(`const { data } = await supabase.from('orders').select('*')\nreturn data`),
      filename: ROUTE,
      options: [{ baseline: [{ file: 'src/app/api/orders/route.ts', function: 'GET', line: "const { data } = await supabase.from('orders').select('*')", count: 1 }] }],
    },
    // 14. Promise.all of plain helpers (each checks its own error) is not a Supabase call.
    { code: wrap(`await Promise.all([upsertSla(supabase, id), notify(id)])`) },
  ],

  invalid: [
    // 1. Destructured data, no error.
    { code: wrap(`const { data } = await supabase.from('orders').select('*')\nreturn data`), errors: [{ messageId: 'unchecked' }] },
    // 2. Renamed data, no error.
    { code: wrap(`const { data: orders } = await supabase.from('orders').select().eq('id', id)\nreturn orders`), errors: [{ messageId: 'unchecked' }] },
    // 3. result.data used, result.error never touched.
    { code: wrap(`const res = await supabase.from('orders').select('*')\nreturn res.data`), errors: [{ messageId: 'unchecked' }] },
    // 4. A write whose result is thrown away.
    { code: wrap(`await supabase.from('orders').update({ status: 'X' }).eq('order_id', id)`), errors: [{ messageId: 'unchecked' }] },
    // 5. RPC.
    { code: wrap(`const { data } = await supabase.rpc('collapse', { id })\nreturn data`), errors: [{ messageId: 'unchecked' }] },
    // 6. Storage.
    { code: wrap(`const { data } = await supabase.storage.from('rx-pdfs').download(id)\nreturn data`), errors: [{ messageId: 'unchecked' }] },
    // 7. auth.admin.
    { code: wrap(`const { data } = await supabase.auth.admin.getUserById(id)\nreturn data.user`), errors: [{ messageId: 'unchecked' }] },
    // 8. error destructured but never read.
    { code: wrap(`const { data, error } = await supabase.from('orders').select('*')\nreturn data`), errors: [{ messageId: 'unchecked' }] },
    // 9. The marker without a reason.
    { code: wrap(`// supabase-error-ok:\nawait supabase.from('orders').delete().eq('order_id', id)`), errors: [{ messageId: 'missingReason' }] },
    // 10. The marker with only spaces.
    { code: wrap(`// supabase-error-ok:    \nawait supabase.from('orders').delete().eq('order_id', id)`), errors: [{ messageId: 'missingReason' }] },
    // 11. Promise.all: the unchecked element is flagged, the checked one is not.
    {
      code: wrap(`const [{ data: a }, { data: b, error: bErr }] = await Promise.all([supabase.from('a').select(), supabase.from('b').select()])\nif (bErr) throw bErr\nreturn [a, b]`),
      errors: [{ messageId: 'unchecked' }],
    },
    // 12. A query built in steps, then awaited.
    { code: wrap(`let q = supabase.from('orders').select('*')\nif (id) q = q.eq('order_id', id)\nconst { data } = await q\nreturn data`), errors: [{ messageId: 'unchecked' }] },
    // 13. Baseline: a NEW unchecked call in a file already on the baseline still fails.
    {
      code: wrap(`const { data } = await supabase.from('orders').select('*')\nconst { data: more } = await supabase.from('order_items').select('*')\nreturn [data, more]`),
      filename: ROUTE,
      options: [{ baseline: [{ file: 'src/app/api/orders/route.ts', function: 'GET', line: "const { data } = await supabase.from('orders').select('*')", count: 1 }] }],
      errors: [{ messageId: 'unchecked', line: 3 }],
    },
    // 14. Baseline counts: a second copy of a baselined line is new.
    {
      code: wrap(`const { data } = await supabase.from('orders').select('*')\nif (id) {\nconst { data } = await supabase.from('orders').select('*')\nreturn data\n}\nreturn data`),
      filename: ROUTE,
      options: [{ baseline: [{ file: 'src/app/api/orders/route.ts', function: 'GET', line: "const { data } = await supabase.from('orders').select('*')", count: 1 }] }],
      errors: [{ messageId: 'unchecked', line: 4 }],
    },
    // 15. Promise.all of Supabase writes, results thrown away.
    { code: wrap(`await Promise.all([supabase.from('a').update({ x: 1 }).eq('id', id), supabase.from('b').delete().eq('id', id)])`), errors: [{ messageId: 'unchecked' }] },
  ],
})
