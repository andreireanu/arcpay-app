-- Allow authenticated users to read their own seller record
-- Required so the qr_offers INSERT policy subquery can resolve seller_wallet
CREATE POLICY "users can read own seller record"
  ON sellers FOR SELECT TO authenticated
  USING (user_id = auth.uid());
