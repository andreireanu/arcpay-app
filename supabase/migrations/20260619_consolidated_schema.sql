-- ArcPay — full schema (single consolidated file; replaces all prior migrations)
--
DROP VIEW  IF EXISTS qr_seller_transactions CASCADE;
DROP TABLE IF EXISTS qr_auto_accept CASCADE;
DROP TABLE IF EXISTS qr_accepted_counter CASCADE;
DROP TABLE IF EXISTS qr_counteroffers_seller_state CASCADE;
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
-- `chain` is the source of truth for which chain an offer lives on (Solana | Sui).
-- price_lamports is base units interpreted per chain (lamports or MIST — both 9
-- decimals), so the value alone is ambiguous; chain disambiguates it and selects
-- the settlement path (Anchor + Helius webhook vs Move + Sui event indexer).
CREATE TABLE public.qr_offers (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  description    text,
  price_lamports bigint      NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  seller_wallet  text        REFERENCES sellers(wallet_address),
  fee_bps        bigint      NOT NULL DEFAULT 0,
  unlimited      boolean     NOT NULL DEFAULT true,
  quantity       integer     NOT NULL DEFAULT 2147483647,
  quantity_sold  integer     NOT NULL DEFAULT 0,
  chain          text        NOT NULL DEFAULT 'solana',
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT qr_offers_pkey PRIMARY KEY (id),
  CONSTRAINT qr_offers_chain_check CHECK (chain IN ('solana', 'sui'))
);

CREATE INDEX qr_offers_chain_idx ON public.qr_offers (chain);

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
-- A completed buy, recorded by the per-chain settlement path (Solana Helius
-- webhook; Sui event indexer). `chain` is denormalized from qr_offers because the
-- dashboards receive raw Realtime INSERT rows with no join and must render SOL vs
-- SUI from the row itself.
CREATE TABLE public.qr_transactions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  offer_id       uuid        NOT NULL REFERENCES qr_offers(id),
  buyer_wallet   text        NOT NULL,
  tx_signature   text        NOT NULL UNIQUE,
  seller_amount  bigint      NOT NULL,
  fee_amount     bigint      NOT NULL,
  quantity       integer     NOT NULL DEFAULT 1,
  chain          text        NOT NULL DEFAULT 'solana',
  created_at     timestamptz DEFAULT now(),
  CONSTRAINT qr_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT qr_transactions_chain_check CHECK (chain IN ('solana', 'sui'))
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

-- Buyers may read the rows where they are the buyer (buyer dashboard's "Items
-- bought" + Transactions tab). Gate on app_metadata.wallet_address (service-role
-- written during auth-exchange), NOT user_metadata (end-user editable).
CREATE POLICY "buyers can read own transactions"
  ON qr_transactions FOR SELECT TO authenticated
  USING (
    buyer_wallet = (auth.jwt() -> 'app_metadata' ->> 'wallet_address')
  );

-- Publish for Realtime so the dashboards update live when a buy lands. RLS above
-- scopes delivery to each role's own rows.
ALTER PUBLICATION supabase_realtime ADD TABLE qr_transactions;

-- ─── qr_ephemeral ────────────────────────────────────────────────────────────
CREATE TABLE public.qr_ephemeral (
  id             uuid        PRIMARY KEY, -- this maps to your ephemeral_uuid
  offer_id       uuid        NOT NULL REFERENCES qr_offers(id),
  status         text        NOT NULL DEFAULT 'pending',
  created_at     timestamptz DEFAULT now()
);

-- RLS enabled with no permissive policies — backend-only table. Only the service
-- role (the counteroffer-authorize edge function) reads/writes it; anon and
-- authenticated are denied. The linter's rls_enabled_no_policy INFO is expected.
ALTER TABLE qr_ephemeral ENABLE ROW LEVEL SECURITY;

-- ─── qr_counteroffers ────────────────────────────────────────────────────────
-- `chain` is denormalized from qr_offers: the buyer's "active offers" list reads
-- this table DIRECTLY (active rows never reach the qr_seller_transactions view,
-- which only unions CONFIRMED rows), so the row must carry chain to render SOL vs
-- SUI. `sui_object_id` holds the on-chain object id of a Sui counter offer so it
-- can be cancelled/deleted later (Solana counter offers live in a PDA derivable
-- from ephemeral_id and need nothing stored); NULL for Solana rows.
CREATE TABLE public.qr_counteroffers (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  offer_id            uuid        NOT NULL REFERENCES qr_offers(id),
  ephemeral_id        uuid        NOT NULL,
  sui_object_id       text,
  buyer_wallet        text        NOT NULL,
  tx_signature        text        NOT NULL UNIQUE,
  seller_amount       bigint      NOT NULL,
  fee_amount          bigint      NOT NULL,
  quantity            integer     NOT NULL DEFAULT 1,
  status              text        NOT NULL DEFAULT 'active',
  returned            boolean     NOT NULL DEFAULT false,
  settle_tx_signature text,
  confirmed_at        timestamptz,
  chain               text        NOT NULL DEFAULT 'solana',
  expiry_at           timestamptz NOT NULL DEFAULT now() + INTERVAL '3 months',
  created_at          timestamptz DEFAULT now(),
  CONSTRAINT qr_counteroffers_pkey PRIMARY KEY (id),
  CONSTRAINT qr_counteroffers_chain_check CHECK (chain IN ('solana', 'sui'))
);

COMMENT ON COLUMN qr_counteroffers.settle_tx_signature IS
  'signature of the admin_settle_offer tx that consumed this record (audit; idempotency is the conditional status flip)';
COMMENT ON COLUMN qr_counteroffers.confirmed_at IS
  'when the settle webhook flipped this counter offer to confirmed (execution time), vs created_at = placement time';

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

-- ─── qr_counteroffers_seller_state ───────────────────────────────────────────
-- Seller-owned per-counteroffer state. qr_counteroffers itself stays
-- backend-write-only — sellers never get write access to it. This table is the
-- only counteroffer-related surface a seller can mutate, and it carries no
-- sensitive data, so the blast radius of any seller write is just their own
-- view state.
--
-- The only state today is "hidden", encoded by row PRESENCE: a row here means
-- that counteroffer is hidden from the seller's active list; no row means shown
-- (the default — the table starts empty). Future seller-only flags (pinned,
-- seen, notes…) can be added here as columns.
CREATE TABLE public.qr_counteroffers_seller_state (
  counteroffer_id uuid PRIMARY KEY REFERENCES qr_counteroffers(id) ON DELETE CASCADE
);

ALTER TABLE qr_counteroffers_seller_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON qr_counteroffers_seller_state FROM anon;

-- A seller may read/insert/delete a row only for a counteroffer that belongs to
-- one of their own offers. There are no updatable columns, so no UPDATE policy.
CREATE POLICY "sellers read own counteroffer state"
  ON qr_counteroffers_seller_state FOR SELECT TO authenticated
  USING (
    counteroffer_id IN (
      SELECT co.id FROM qr_counteroffers co
      JOIN qr_offers o ON o.id = co.offer_id
      WHERE o.seller_wallet IN (
        SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "sellers hide own counteroffers"
  ON qr_counteroffers_seller_state FOR INSERT TO authenticated
  WITH CHECK (
    counteroffer_id IN (
      SELECT co.id FROM qr_counteroffers co
      JOIN qr_offers o ON o.id = co.offer_id
      WHERE o.seller_wallet IN (
        SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
      )
    )
  );

CREATE POLICY "sellers unhide own counteroffers"
  ON qr_counteroffers_seller_state FOR DELETE TO authenticated
  USING (
    counteroffer_id IN (
      SELECT co.id FROM qr_counteroffers co
      JOIN qr_offers o ON o.id = co.offer_id
      WHERE o.seller_wallet IN (
        SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
      )
    )
  );

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

-- ─── qr_auto_accept ──────────────────────────────────────────────────────────
-- A seller's standing auto-accept rule for one offer. The seller stores how many
-- of the best counter offers to accept (`quantity`) and a minimum average price
-- (`avg_price`, base units — lamports/MIST). When a new counter offer is recorded,
-- the counteroffer webhook evaluates this rule and, if the best `quantity` active
-- offers average at least `avg_price`, settles them to the seller via
-- admin_settle_offer. No per-batch on-chain consent is needed — this row IS the
-- stored consent (the same trust model the accept flow already relies on).
--
-- One-shot: when it fires, `triggered_at` is stamped (disarming it) and
-- `triggered_price` records the average actually achieved, kept as an audit trail.
-- Saving the rule again clears both stamps to re-arm it.
CREATE TABLE public.qr_auto_accept (
  offer_id        uuid        PRIMARY KEY REFERENCES qr_offers(id) ON DELETE CASCADE,
  quantity        integer     NOT NULL CHECK (quantity > 0),
  avg_price       bigint      NOT NULL CHECK (avg_price >= 0),
  triggered_price bigint,
  triggered_at    timestamptz,
  created_at      timestamptz DEFAULT now()
);

COMMENT ON COLUMN public.qr_auto_accept.quantity IS
  'number of best counter offers to auto-accept in one batch';
COMMENT ON COLUMN public.qr_auto_accept.avg_price IS
  'minimum average price (seller_amount + fee_amount, base units) the best N must meet';
COMMENT ON COLUMN public.qr_auto_accept.triggered_price IS
  'average price (base units) of the batch that actually fired; NULL while armed';
COMMENT ON COLUMN public.qr_auto_accept.triggered_at IS
  'when the rule fired; NULL while armed (one-shot guard)';

ALTER TABLE public.qr_auto_accept ENABLE ROW LEVEL SECURITY;

-- Seller manages the rule only for offers they own (mirrors qr_offers ownership).
-- The backend evaluates/stamps it with the service role, which bypasses RLS.
CREATE POLICY "sellers manage own auto-accept"
  ON public.qr_auto_accept FOR ALL TO authenticated
  USING (
    offer_id IN (
      SELECT id FROM qr_offers
      WHERE seller_wallet IN (
        SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    offer_id IN (
      SELECT id FROM qr_offers
      WHERE seller_wallet IN (
        SELECT wallet_address FROM sellers WHERE user_id = auth.uid()
      )
    )
  );

-- ─── qr_seller_transactions (view) ───────────────────────────────────────────
-- The seller's transaction history is a UNION of two sources: direct buys
-- (qr_transactions) and settled counter offers (qr_counteroffers WHERE status
-- IN ('confirmed','auto_confirmed')), exposed as one ordered, paginatable
-- stream. The counter-offer source is tagged 'auto_confirmed' when the
-- auto-accept rule settled it, else 'counter_offer'.
--
-- security_invoker = true → the view runs with the caller's privileges, so RLS on
-- the underlying tables scopes rows per role. It is read from BOTH sides (a seller
-- reading their offers' transactions, a buyer reading their own purchases); a
-- wallet that both sells and buys satisfies both policies, so each query must
-- filter explicitly — buyers by buyer_wallet, sellers by seller_wallet. A counter
-- offer contributes its execution time (confirmed_at, COALESCE to created_at for
-- legacy rows). chain is surfaced so amounts render in the right token.
CREATE VIEW public.qr_seller_transactions
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
    CASE WHEN c.status = 'auto_confirmed' THEN 'auto_confirmed'
         ELSE 'counter_offer' END          AS source,
    o.seller_wallet,
    o.chain
  FROM public.qr_counteroffers c
  JOIN public.qr_offers o ON o.id = c.offer_id
  WHERE c.status IN ('confirmed', 'auto_confirmed');

REVOKE ALL ON public.qr_seller_transactions FROM anon;
GRANT SELECT ON public.qr_seller_transactions TO authenticated;

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

-- ─── Sui indexer internal tables: lock down RLS ───────────────────────────────
-- The Rust Sui event indexer creates two of its own tables in the public schema
-- (watermarks — checkpoint cursor; __diesel_schema_migrations — Diesel
-- bookkeeping). Both are written ONLY by the indexer (service-role key, bypasses
-- RLS). Enable RLS with NO policies so the anon/authenticated browser keys can't
-- reach them and the "RLS disabled in public" linter warning clears; deny-all is
-- the goal. They're created by the indexer, not this repo, so on a fresh reset
-- they won't exist — guard each ALTER so the reset doesn't fail.
DO $$
BEGIN
  IF to_regclass('public.watermarks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.watermarks ENABLE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public.__diesel_schema_migrations') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.__diesel_schema_migrations ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

-- ─── Seed ────────────────────────────────────────────────────────────────────
INSERT INTO products (id, name, description, image_url, fee_bps)
VALUES (
  '2b78e60b-533d-469d-937e-aa462dc37c28',
  'QR Generator',
  'Create QR codes for your product listings and accept SOL payments on-chain.',
  'https://twjaooacmrveivxxfwyx.supabase.co/storage/v1/object/public/assets/qr.jpg',
  100
) ON CONFLICT (id) DO NOTHING;
