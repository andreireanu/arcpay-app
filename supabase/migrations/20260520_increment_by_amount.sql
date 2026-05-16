CREATE OR REPLACE FUNCTION increment_offer_quantity_sold_by(p_offer_id uuid, p_amount integer)
RETURNS void AS $$
BEGIN
  UPDATE qr_offers
  SET
    quantity_sold = quantity_sold + p_amount,
    status = CASE
      WHEN quantity_sold + p_amount >= quantity THEN 'sold'
      ELSE status
    END
  WHERE id = p_offer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
