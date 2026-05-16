-- ArcPay — full schema (consolidated, replaces all prior migrations)
DROP TABLE IF EXISTS qr_counteroffers CASCADE;
DROP TABLE IF EXISTS qr_ephemeral CASCADE;
DROP TABLE IF EXISTS qr_transactions CASCADE;
DROP TABLE IF EXISTS qr_offers CASCADE;
DROP TABLE IF EXISTS buyers CASCADE;
DROP TABLE IF EXISTS sellers CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP FUNCTION IF EXISTS increment_offer_quantity_sold(uuid);

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

-- ─── qr_counteroffers ────────────────────────────────────────────────────────
CREATE TABLE public.qr_counteroffers (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  offer_id     uuid        NOT NULL REFERENCES qr_offers(id),
  buyer_wallet text        NOT NULL,
  tx_signature text        NOT NULL UNIQUE,
  amount       bigint      NOT NULL,
  quantity     integer     NOT NULL DEFAULT 1,
  status       text        NOT NULL DEFAULT 'active',
  expiry_at    timestamptz NOT NULL DEFAULT now() + INTERVAL '3 months',
  created_at   timestamptz DEFAULT now(),
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

CREATE POLICY "buyers can read own counteroffers"
  ON qr_counteroffers FOR SELECT TO authenticated
  USING (
    buyer_wallet = (auth.jwt() -> 'user_metadata' ->> 'wallet_address')
  );

-- ─── qr_ephemeral ────────────────────────────────────────────────────────────
CREATE TABLE public.qr_ephemeral (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id       uuid        NOT NULL REFERENCES qr_offers(id),
  ephemeral_uuid uuid        NOT NULL UNIQUE,
  status         text        NOT NULL DEFAULT 'pending',
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE qr_ephemeral ENABLE ROW LEVEL SECURITY;

-- ─── Helper function ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION increment_offer_quantity_sold(p_offer_id uuid)
RETURNS void AS $$
BEGIN
  UPDATE qr_offers
  SET
    quantity_sold = quantity_sold + 1,
    status = CASE
      WHEN quantity_sold + 1 >= quantity THEN 'sold'
      ELSE status
    END
  WHERE id = p_offer_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── Seed ────────────────────────────────────────────────────────────────────
INSERT INTO products (id, name, description, image_url, fee_bps)
VALUES (
  '2b78e60b-533d-469d-937e-aa462dc37c28',
  'QR Generator',
  'Create QR codes for your product listings and accept SOL payments on-chain.',
  'https://twjaooacmrveivxxfwyx.supabase.co/storage/v1/object/public/assets/qr.jpg',
  1000
) ON CONFLICT (id) DO NOTHING;
