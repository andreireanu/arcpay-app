-- ─── qr_offers.chain: tag each offer with the chain it lives on ──────────────
-- Arc Pay is now multi-chain (Solana + Sui). An offer's price is stored in
-- `price_lamports`, but that number means SOL (lamports) or SUI (MIST) depending
-- on the chain — both use 9 decimals, so the value alone is ambiguous. The chain
-- also determines the settlement path (Anchor program + Helius webhook for
-- Solana, Move package + Sui events for Sui) and how amounts/fees are rendered.
--
-- `chain` is stored ONLY on qr_offers, the source of truth. qr_transactions and
-- qr_counteroffers reference offer_id → qr_offers, so their chain is derived via
-- that FK (and exposed through the qr_seller_transactions view below) rather than
-- duplicated, which would risk drift.

ALTER TABLE public.qr_offers
  ADD CONSTRAINT qr_offers_chain_check CHECK (chain IN ('solana', 'sui'));

CREATE INDEX qr_offers_chain_idx ON public.qr_offers (chain);

-- ─── qr_seller_transactions: expose chain ────────────────────────────────────
-- Re-create the view to surface o.chain so the dashboards can render each
-- transaction's amount in the right token (SOL vs SUI) without re-deriving it
-- from the wallet address format.
--
-- chain is appended as the LAST column: CREATE OR REPLACE VIEW can only add
-- columns at the end, never reorder or rename existing ones, so the prior column
-- order (…, source, seller_wallet) must be preserved exactly.
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
    o.seller_wallet,
    o.chain
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
    o.seller_wallet,
    o.chain
  FROM public.qr_counteroffers c
  JOIN public.qr_offers o ON o.id = c.offer_id
  WHERE c.status = 'confirmed';

REVOKE ALL ON public.qr_seller_transactions FROM anon;
GRANT SELECT ON public.qr_seller_transactions TO authenticated;
