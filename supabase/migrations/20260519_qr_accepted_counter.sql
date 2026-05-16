-- ─── qr_accepted_counter ─────────────────────────────────────────────────────
-- Ephemeral witness table for a seller accepting one or more counter offers.
-- Created when the seller initiates acceptance; updated by the webhook on
-- settlement. Mirrors the lifecycle pattern of qr_ephemeral.

CREATE TABLE public.qr_accepted_counter (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  offers     jsonb       NOT NULL,                          -- array of qr_counteroffers IDs
  status     text        NOT NULL DEFAULT 'pending',        -- pending | completed | failed
  created_at timestamptz DEFAULT now()
);

-- RLS enabled with no permissive policies — only the service role (backend)
-- can read or write this table. Anon and authenticated roles are denied.
ALTER TABLE qr_accepted_counter ENABLE ROW LEVEL SECURITY;
