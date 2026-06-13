-- ─── qr_counteroffers.confirmed_at ───────────────────────────────────────────
-- The moment the settle webhook (sol-refund-webhook, on the OfferBought event)
-- flips a counter offer to `confirmed` — i.e. when it was executed — as opposed
-- to created_at, which is when the buyer first placed it. The seller's unified
-- transactions list needs the execution time, mirroring qr_transactions.created_at
-- for direct buys.
ALTER TABLE public.qr_counteroffers
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;

-- Recreate the unified transactions view so a counter offer contributes its
-- execution time (confirmed_at) rather than its placement time. COALESCE falls
-- back to created_at for rows confirmed before this column existed, so legacy
-- transactions never show a null/invalid date.
CREATE OR REPLACE VIEW public.qr_seller_transactions
WITH (security_invoker = true) AS
  SELECT
    t.id,
    t.offer_id,
    o.name          AS offer_name,
    t.buyer_wallet,
    t.tx_signature,
    t.seller_amount,
    t.fee_amount,
    t.quantity,
    t.created_at,
    'buy'::text     AS source
  FROM public.qr_transactions t
  JOIN public.qr_offers o ON o.id = t.offer_id
  UNION ALL
  SELECT
    c.id,
    c.offer_id,
    o.name                                 AS offer_name,
    c.buyer_wallet,
    c.tx_signature,
    c.seller_amount,
    c.fee_amount,
    c.quantity,
    COALESCE(c.confirmed_at, c.created_at) AS created_at,
    'counter_offer'::text                  AS source
  FROM public.qr_counteroffers c
  JOIN public.qr_offers o ON o.id = c.offer_id
  WHERE c.status = 'confirmed';

REVOKE ALL ON public.qr_seller_transactions FROM anon;
GRANT SELECT ON public.qr_seller_transactions TO authenticated;
