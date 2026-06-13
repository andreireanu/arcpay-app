-- ─── qr_seller_transactions (view) ───────────────────────────────────────────
-- The seller's transaction history is a UNION of two sources: direct buys
-- (qr_transactions) and confirmed counter offers (qr_counteroffers WHERE
-- status = 'confirmed'). The dashboard previously fetched both, merged, and
-- sorted in memory — which makes true server-side pagination impossible.
--
-- This view exposes the merged, normalized stream so a single ordered
-- .range() + count query can paginate it (blockchain-explorer style).
--
-- security_invoker = true → the view executes with the *caller's* privileges,
-- so the existing RLS on qr_transactions and qr_counteroffers still scopes rows
-- to the seller's own offers. The qr_offers join only supplies the offer name
-- and is already publicly selectable.
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
    o.name              AS offer_name,
    c.buyer_wallet,
    c.tx_signature,
    c.seller_amount,
    c.fee_amount,
    c.quantity,
    c.created_at,
    'counter_offer'::text AS source
  FROM public.qr_counteroffers c
  JOIN public.qr_offers o ON o.id = c.offer_id
  WHERE c.status = 'confirmed';

-- Backend-write tables stay closed to anon; the view is read-only for sellers.
REVOKE ALL ON public.qr_seller_transactions FROM anon;
GRANT SELECT ON public.qr_seller_transactions TO authenticated;
