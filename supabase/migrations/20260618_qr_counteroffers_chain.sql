-- ─── qr_counteroffers.chain ──────────────────────────────────────────────────
-- A counter offer is itself an on-chain action (the buyer escrows funds). The
-- buyer's "active offers" list reads qr_counteroffers DIRECTLY — active rows
-- never reach the qr_seller_transactions view, which only unions CONFIRMED
-- counter offers — so storing chain here lets that direct read render SOL vs SUI
-- without an extra join to qr_offers.
--
-- It always equals the parent offer's chain (you can't counter-offer on a Sui
-- offer from Solana), so existing rows backfill from qr_offers; new rows must be
-- written with that chain by the counter-offer write path.
ALTER TABLE public.qr_counteroffers
  ADD COLUMN chain text NOT NULL DEFAULT 'solana';

ALTER TABLE public.qr_counteroffers
  ADD CONSTRAINT qr_counteroffers_chain_check CHECK (chain IN ('solana', 'sui'));

UPDATE public.qr_counteroffers c
  SET chain = o.chain
  FROM public.qr_offers o
  WHERE o.id = c.offer_id;
