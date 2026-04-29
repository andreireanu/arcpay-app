-- Prevent updates to canceled offers at the DB level
DROP POLICY IF EXISTS "sellers can update own offers" ON qr_offers;

CREATE POLICY "sellers can update own offers"
  ON qr_offers FOR UPDATE TO authenticated
  USING (
    status != 'canceled'
    AND seller_wallet IN (
      SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
    )
  );
