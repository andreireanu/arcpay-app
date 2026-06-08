-- ArcPay — full schema (consolidated, replaces all prior migrations)
DROP TABLE IF EXISTS qr_accepted_counter CASCADE;
DROP TABLE IF EXISTS qr_counteroffers CASCADE;
DROP TABLE IF EXISTS qr_ephemeral CASCADE;
DROP TABLE IF EXISTS qr_transactions CASCADE;
DROP TABLE IF EXISTS qr_offers CASCADE;
DROP TABLE IF EXISTS buyers CASCADE;
DROP TABLE IF EXISTS sellers CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP FUNCTION IF EXISTS increment_offer_quantity_sold(uuid);
DROP FUNCTION IF EXISTS increment_offer_quantity_sold_by(uuid, integer);

-- ─── products ────────────────────────────────────────────────────────────────
CREATE TABLE public.products (
  id          uuid        NOT NULL DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  description text,
  image_url   text,
  fee_bps     bigint      NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id)
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated users can read products"
  ON products FOR SELECT TO authenticated USING (true);

-- ─── sellers ─────────────────────────────────────────────────────────────────
CREATE TABLE public.sellers (
  id             text        NOT NULL DEFAULT (gen_random_uuid())::text,
  wallet_address text        NOT NULL UNIQUE,
  user_id        uuid        REFERENCES auth.users(id),
  registered_at  timestamptz DEFAULT now(),
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT sellers_pkey PRIMARY KEY (id)
);

ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own seller record"
  ON sellers FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "users can insert own seller record"
  ON sellers FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ─── buyers ──────────────────────────────────────────────────────────────────
CREATE TABLE public.buyers (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id),
  wallet_address text        NOT NULL UNIQUE,
  confirmed      boolean     NOT NULL DEFAULT false,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT buyers_pkey PRIMARY KEY (id)
);

ALTER TABLE buyers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own buyer profile"
  ON buyers FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── qr_offers ───────────────────────────────────────────────────────────────
CREATE TABLE public.qr_offers (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  description    text,
  price_lamports bigint      NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  seller_wallet  text        REFERENCES sellers(wallet_address),
  fee_bps        bigint      NOT NULL DEFAULT 0,
  quantity       integer     NOT NULL DEFAULT 1,
  quantity_sold  integer     NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT qr_offers_pkey PRIMARY KEY (id)
);

ALTER TABLE qr_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "offers are public"
  ON qr_offers FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "sellers can insert own offers"
  ON qr_offers FOR INSERT TO authenticated
  WITH CHECK (
    seller_wallet IN (
      SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
    )
  );

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

CREATE POLICY "sellers can delete own offers"
  ON qr_offers FOR DELETE TO authenticated
  USING (
    seller_wallet IN (
      SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
    )
  );

ALTER PUBLICATION supabase_realtime ADD TABLE qr_offers;

-- ─── qr_transactions ─────────────────────────────────────────────────────────
CREATE TABLE public.qr_transactions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  offer_id       uuid        NOT NULL REFERENCES qr_offers(id),
  buyer_wallet   text        NOT NULL,
  tx_signature   text        NOT NULL UNIQUE,
  seller_amount  bigint      NOT NULL,
  fee_amount     bigint      NOT NULL,
  quantity       integer     NOT NULL DEFAULT 1,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT qr_transactions_pkey PRIMARY KEY (id)
);

ALTER TABLE qr_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sellers can read own transactions"
  ON qr_transactions FOR SELECT TO authenticated
  USING (
    offer_id IN (
      SELECT id FROM qr_offers
      WHERE seller_wallet IN (
        SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
      )
    )
  );

-- ─── qr_ephemeral ────────────────────────────────────────────────────────────
CREATE TABLE public.qr_ephemeral (
  id             uuid        PRIMARY KEY, -- this maps to your ephemeral_uuid
  offer_id       uuid        NOT NULL REFERENCES qr_offers(id),
  status         text        NOT NULL DEFAULT 'pending',
  created_at     timestamptz DEFAULT now()
);

-- RLS enabled with no permissive policies — backend-only table. Only the service
-- role (the sol-counteroffer-* edge functions) reads/writes it; anon and
-- authenticated are denied. The linter's rls_enabled_no_policy INFO is expected.
ALTER TABLE qr_ephemeral ENABLE ROW LEVEL SECURITY;

-- ─── qr_counteroffers ────────────────────────────────────────────────────────
CREATE TABLE public.qr_counteroffers (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  offer_id       uuid        NOT NULL REFERENCES qr_offers(id),
  ephemeral_id   uuid        NOT NULL,
  buyer_wallet   text        NOT NULL,
  tx_signature   text        NOT NULL UNIQUE,
  amount         bigint      NOT NULL,
  quantity       integer     NOT NULL DEFAULT 1,
  status         text        NOT NULL DEFAULT 'active',
  rent_returned  boolean     NOT NULL DEFAULT false,
  expiry_at      timestamptz NOT NULL DEFAULT now() + INTERVAL '3 months',
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT qr_counteroffers_pkey PRIMARY KEY (id)
);

ALTER TABLE qr_counteroffers ENABLE ROW LEVEL SECURITY;

REVOKE SELECT ON qr_counteroffers FROM anon;

CREATE POLICY "sellers can read counteroffers on own offers"
  ON qr_counteroffers FOR SELECT TO authenticated
  USING (
    offer_id IN (
      SELECT id FROM qr_offers
      WHERE seller_wallet IN (
        SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
      )
    )
  );

-- Gate on app_metadata, NOT user_metadata: user_metadata is editable by end
-- users via supabase.auth.updateUser and must never be used in a security
-- context. app_metadata is written only by the service role (auth-exchange).
CREATE POLICY "buyers can read own counteroffers"
  ON qr_counteroffers FOR SELECT TO authenticated
  USING (
    buyer_wallet = (auth.jwt() -> 'app_metadata' ->> 'wallet_address')
  );

ALTER PUBLICATION supabase_realtime ADD TABLE qr_counteroffers;

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

-- ─── Helper functions ────────────────────────────────────────────────────────
-- Called only by the backend (service role) from the webhooks. SECURITY DEFINER
-- so it can update qr_offers regardless of caller, with a pinned empty
-- search_path (all objects schema-qualified) to block search_path hijacking.
-- EXECUTE is revoked from anon/authenticated so it cannot be called directly via
-- /rest/v1/rpc — only the service role may invoke it.
CREATE OR REPLACE FUNCTION public.increment_offer_quantity_sold_by(p_offer_id uuid, p_amount integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.qr_offers
  SET
    quantity_sold = quantity_sold + p_amount,
    status = CASE
      WHEN quantity_sold + p_amount >= quantity THEN 'sold'
      ELSE status
    END
  WHERE id = p_offer_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.increment_offer_quantity_sold_by(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.increment_offer_quantity_sold_by(uuid, integer) TO service_role;

-- ─── Seed ────────────────────────────────────────────────────────────────────
INSERT INTO products (id, name, description, image_url, fee_bps)
VALUES (
  '2b78e60b-533d-469d-937e-aa462dc37c28',
  'QR Generator',
  'Create QR codes for your product listings and accept SOL payments on-chain.',
  'https://twjaooacmrveivxxfwyx.supabase.co/storage/v1/object/public/assets/qr.jpg',
  1000
) ON CONFLICT (id) DO NOTHING;
