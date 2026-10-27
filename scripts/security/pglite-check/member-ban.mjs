// L12 on PGlite: set_clinic_member_active reactivation lifts only the ban
// deactivation set. Usage: node member-ban.mjs <migrated-db-dir> <scratch-copy-dir>
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { cpSync, rmSync } from 'node:fs'

const [base, work] = process.argv.slice(2)
rmSync(work, { recursive: true, force: true })
cpSync(base, work, { recursive: true })
const db = new PGlite(work, { extensions: { pg_trgm, pgcrypto } })

const C = 'c1000000-0000-4000-8000-000000000001'
const ADMIN = 'u0000000-0000-4000-8000-000000000000'.replace('u', 'a')
const user = n => `b0000000-0000-4000-8000-00000000000${n}`
await db.exec(`
  INSERT INTO clinics (clinic_id, name, stripe_connect_status) VALUES ('${C}', 'Ban Test Clinic', 'ACTIVE');
  INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
    ('${ADMIN}', 'admin@ban.test', '{"app_role":"clinic_admin","clinic_id":"${C}"}'),
    ('${user(1)}', 'one@ban.test',   '{"app_role":"provider","clinic_id":"${C}"}'),
    ('${user(2)}', 'two@ban.test',   '{"app_role":"provider","clinic_id":"${C}"}'),
    ('${user(3)}', 'three@ban.test', '{"app_role":"provider","clinic_id":"${C}"}'),
    ('${user(4)}', 'four@ban.test',  '{"app_role":"provider","clinic_id":"${C}"}'),
    ('${user(5)}', 'five@ban.test',  '{"app_role":"provider","clinic_id":"${C}"}'),
    ('${user(6)}', 'six@ban.test',   '{"app_role":"provider","clinic_id":"${C}"}');
  INSERT INTO auth.sessions (id, user_id) VALUES ('d0000000-0000-4000-8000-000000000001', '${user(1)}');
`)

const call = async (u, active) => (await db.query(`SELECT set_clinic_member_active($1, $2, $3, $4) AS r`, [C, u, active, ADMIN])).rows[0].r.status
const state = async u => (await db.query(`
  SELECT banned_until, banned_until > now() + interval '99 years' AS long_ban,
         raw_app_meta_data ? 'deactivated_at' AS deactivated,
         raw_app_meta_data ? 'deactivation_banned_until' AS recorded,
         raw_app_meta_data ? 'banned_until_before_deactivation' AS before_recorded
  FROM auth.users WHERE id = $1`, [u])).rows[0]

let failures = 0
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`) }

// 1. No earlier ban: deactivate, then reactivate clears it.
check('1 deactivate', await call(user(1), false) === 'deactivated')
let s = await state(user(1))
check('1 banned 100 years, recorded, sessions gone', s.long_ban && s.recorded && !s.before_recorded && (await db.query(`SELECT count(*)::int n FROM auth.sessions WHERE user_id = $1`, [user(1)])).rows[0].n === 0)
check('1 reactivate', await call(user(1), true) === 'reactivated')
s = await state(user(1))
check('1 ban cleared, records removed', s.banned_until === null && !s.deactivated && !s.recorded && !s.before_recorded)

// 2. An earlier ban (7 days) is restored on reactivation.
await db.exec(`UPDATE auth.users SET banned_until = now() + interval '7 days' WHERE id = '${user(2)}'`)
const before2 = (await state(user(2))).banned_until
await call(user(2), false)
s = await state(user(2))
check('2 deactivation overrides the 7-day ban and records it', s.long_ban && s.before_recorded)
await call(user(2), true)
s = await state(user(2))
check('2 reactivation restores the 7-day ban', s.banned_until !== null && new Date(s.banned_until).getTime() === new Date(before2).getTime(), `${s.banned_until}`)

// 3. The earlier ban expired while deactivated: cleared.
await db.exec(`UPDATE auth.users SET banned_until = now() + interval '7 days' WHERE id = '${user(3)}'`)
await call(user(3), false)
await db.exec(`UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('banned_until_before_deactivation', now() - interval '1 day') WHERE id = '${user(3)}'`)
await call(user(3), true)
s = await state(user(3))
check('3 an expired earlier ban is not restored', s.banned_until === null && !s.before_recorded)

// 4. Someone else re-banned the member after deactivation: kept.
await call(user(4), false)
await db.exec(`UPDATE auth.users SET banned_until = now() + interval '1 year' WHERE id = '${user(4)}'`)
const other4 = (await state(user(4))).banned_until
await call(user(4), true)
s = await state(user(4))
check('4 a ban set by something else is kept', s.banned_until !== null && new Date(s.banned_until).getTime() === new Date(other4).getTime() && !s.deactivated && !s.recorded)

// 5. Deactivated before this migration (the old function's shape): its ban is recognised and cleared.
await db.exec(`
  UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('deactivated_at', now(), 'deactivated_by', '${ADMIN}'::uuid),
         banned_until = now() + interval '100 years' WHERE id = '${user(5)}'`)
await call(user(5), true)
s = await state(user(5))
check('5 a legacy deactivation ban is cleared', s.banned_until === null && !s.deactivated)

// 6. Legacy shape, but the ban was changed by something else: kept.
await db.exec(`
  UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || jsonb_build_object('deactivated_at', now() - interval '2 days', 'deactivated_by', '${ADMIN}'::uuid),
         banned_until = now() + interval '30 days' WHERE id = '${user(6)}'`)
await call(user(6), true)
s = await state(user(6))
check('6 a legacy member with another ban keeps it', s.banned_until !== null && !s.deactivated)

// 7. Statuses unchanged.
check('7 reactivating an active member: unchanged', await call(user(1), true) === 'unchanged')
await call(user(1), false)
check('7 deactivating twice: unchanged', await call(user(1), false) === 'unchanged')
check('7 last admin', await call(ADMIN, false) === 'last_admin')
check('7 not in this clinic: not_found', (await db.query(`SELECT set_clinic_member_active($1, $2, false, $3) AS r`, ['c9999999-0000-4000-8000-000000000001', user(2), ADMIN])).rows[0].r.status === 'not_found')
const ev = (await db.query(`SELECT event, count(*)::int n FROM clinic_onboarding_events WHERE clinic_id = $1 GROUP BY 1 ORDER BY 1`, [C])).rows
check('7 events written', JSON.stringify(ev) === JSON.stringify([{ event: 'member_deactivated', n: 5 }, { event: 'member_reactivated', n: 6 }]), JSON.stringify(ev))

console.log(`member-ban: ${failures} failed`)
await db.close()
