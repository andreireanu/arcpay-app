-- Per-offer escrow redesign (2026-06-11)
--
-- Escrow moved from the per-seller vault PDA into each offer record on chain.
-- accept_offer became a consent-only event; all payouts are backend-driven via
-- admin_settle_offer, which emits OfferBought (paid to seller, minus fee) or
-- OfferRefunded (returned to buyer). A counteroffer is `confirmed` only when its
-- own settle lands — never at the accept event.

ALTER TABLE qr_counteroffers
  ADD COLUMN IF NOT EXISTS settle_tx_signature text;

COMMENT ON COLUMN qr_counteroffers.settle_tx_signature IS
  'signature of the admin_settle_offer tx that consumed this record (audit; idempotency is the conditional status flip)';
