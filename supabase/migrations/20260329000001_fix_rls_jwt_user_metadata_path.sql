-- Fix RLS policies: clinic_id lives in user_metadata, not top-level JWT claims.
-- auth.jwt() ->> 'clinic_id' always returns NULL → no rows visible to browser client.
-- Correct path: auth.jwt() -> 'user_metadata' ->> 'clinic_id'

DROP POLICY IF EXISTS orders_clinic_user_select ON orders;
CREATE POLICY orders_clinic_user_select ON orders
  FOR SELECT TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS orders_clinic_user_insert ON orders;
CREATE POLICY orders_clinic_user_insert ON orders
  FOR INSERT TO authenticated
  WITH CHECK (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);

DROP POLICY IF EXISTS orders_clinic_user_update ON orders;
CREATE POLICY orders_clinic_user_update ON orders
  FOR UPDATE TO authenticated
  USING (clinic_id = (auth.jwt() -> 'user_metadata' ->> 'clinic_id')::UUID);
