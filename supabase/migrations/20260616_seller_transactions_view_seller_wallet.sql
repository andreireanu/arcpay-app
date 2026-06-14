-- ─── qr_seller_transactions: expose seller_wallet for explicit scoping ────────
-- The view is read from BOTH perspectives now: a seller reading transactions on
-- their offers, and (since 20260615) a buyer reading their own purchases. A
-- wallet that both sells and buys satisfies both RLS policies, so the view can't
-- be scoped by RLS alone — it returns the union of both roles' rows. Each query
-- must filter explicitly: buyers by buyer_wallet (already a column), sellers by
-- seller_wallet (added here from the joined qr_offers row).
--
-- seller_wallet is appended as the LAST column: CREATE OR REPLACE VIEW can only
-- add columns at the end, never reorder or rename existing ones, so the prior
-- column order (…, created_at, source) must be preserved exactly.
CREATE OR REPLACE VIEW public.qr_seller_transactions
WITH (security_invoker = true) AS
  SELECT
    t.id,
    t.offer_id,
    o.name           AS offer_name,
    t.buyer_wallet,
    t.tx_signature,
    t.seller_amount,
    t.fee_amount,
    t.quantity,
    t.created_at,
    'buy'::text      AS source,
    o.seller_wallet
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
    'counter_offer'::text                  AS source,
    o.seller_wallet
  FROM public.qr_counteroffers c
  JOIN public.qr_offers o ON o.id = c.offer_id
  WHERE c.status = 'confirmed';

REVOKE ALL ON public.qr_seller_transactions FROM anon;
GRANT SELECT ON public.qr_seller_transactions TO authenticated;
