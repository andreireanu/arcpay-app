-- Clean slate: drop all tables in reverse dependency order
DROP TABLE IF EXISTS qr_transactions;
DROP TABLE IF EXISTS qr_offers;
DROP TABLE IF EXISTS sellers;
DROP TABLE IF EXISTS products;

-- ─── products ────────────────────────────────────────────────────────────────
CREATE TABLE public.products (
  id          uuid    NOT NULL DEFAULT gen_random_uuid(),
  name        text    NOT NULL,
  description text,
  image_url   text,
  fee_bps     bigint  NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  CONSTRAINT products_pkey PRIMARY KEY (id)
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read products
CREATE POLICY "authenticated users can read products"
  ON products FOR SELECT TO authenticated USING (true);

INSERT INTO products (name, description, image_url) VALUES (
  'QR Generator',
  'Create QR codes for your product listings and accept SOL payments on-chain.',
  'https://twjaooacmrveivxxfwyx.supabase.co/storage/v1/object/public/assets/qr.jpg'
);

-- ─── sellers ─────────────────────────────────────────────────────────────────
CREATE TABLE public.sellers (
  id             text  NOT NULL DEFAULT (gen_random_uuid())::text,
  wallet_address text  NOT NULL UNIQUE,
  user_id        uuid  REFERENCES auth.users(id),
  registered_at  timestamptz DEFAULT now(),
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT sellers_pkey PRIMARY KEY (id)
);

ALTER TABLE sellers ENABLE ROW LEVEL SECURITY;
-- No policies: only service role (backend) can read or write

-- ─── qr_offers ───────────────────────────────────────────────────────────────
CREATE TABLE public.qr_offers (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  name           text    NOT NULL,
  description    text,
  price_lamports bigint  NOT NULL,
  status         text    NOT NULL DEFAULT 'active',
  seller_wallet  text    REFERENCES sellers(wallet_address),
  fee_bps        bigint  NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT qr_offers_pkey PRIMARY KEY (id)
);

ALTER TABLE qr_offers ENABLE ROW LEVEL SECURITY;

-- Anyone can read offers (pay page is public)
CREATE POLICY "offers are public"
  ON qr_offers FOR SELECT TO anon, authenticated USING (true);

-- Sellers can insert offers tied to their own registered wallet
CREATE POLICY "sellers can insert own offers"
  ON qr_offers FOR INSERT TO authenticated
  WITH CHECK (
    seller_wallet IN (
      SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
    )
  );

-- Sellers can update/delete their own offers
CREATE POLICY "sellers can update own offers"
  ON qr_offers FOR UPDATE TO authenticated
  USING (
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

-- Enable Realtime so the frontend can watch offer status changes
ALTER PUBLICATION supabase_realtime ADD TABLE qr_offers;

-- ─── qr_transactions ─────────────────────────────────────────────────────────
CREATE TABLE public.qr_transactions (
  id             uuid   NOT NULL DEFAULT gen_random_uuid(),
  offer_id       uuid   NOT NULL REFERENCES qr_offers(id),
  buyer_wallet   text   NOT NULL,
  seller_wallet  text   NOT NULL,
  tx_signature   text   NOT NULL UNIQUE,
  seller_amount  bigint NOT NULL,
  fee_amount     bigint NOT NULL,
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT qr_transactions_pkey PRIMARY KEY (id)
);

ALTER TABLE qr_transactions ENABLE ROW LEVEL SECURITY;

-- Authenticated sellers can only read their own transactions
CREATE POLICY "sellers can read own transactions"
  ON qr_transactions FOR SELECT TO authenticated
  USING (
    seller_wallet IN (
      SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
    )
  );
