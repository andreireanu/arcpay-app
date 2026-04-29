-- Fix: separate USING (row filter) from WITH CHECK (new value check)
-- so that setting status to 'canceled' is allowed, but updating already-canceled rows is not
DROP POLICY IF EXISTS "sellers can update own offers" ON qr_offers;

CREATE POLICY "sellers can update own offers"
  ON qr_offers FOR UPDATE TO authenticated
  USING (
    status != 'canceled'
    AND seller_wallet IN (
      SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    seller_wallet IN (
      SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
    )
  );
