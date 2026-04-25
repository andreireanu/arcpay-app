-- listing_pda must be unique to serve as a FK target
alter table qr_listings add constraint qr_listings_listing_pda_unique unique (listing_pda);

-- Purchase record — written by webhook after AcceptOffer event
create table qr_transactions (
  id uuid primary key default gen_random_uuid(),
  listing_pda text not null references qr_listings(listing_pda),
  buyer_wallet text not null,
  tx_signature text not null unique,
  price_lamports bigint not null,
  created_at timestamptz default now()
);

alter table qr_transactions enable row level security;

-- Only the seller who owns the offer can read its transactions
create policy "sellers can read own transactions"
  on qr_transactions for select
  to authenticated
  using (
    listing_pda in (
      select ql.listing_pda
      from qr_listings ql
      join qr_offers_sellers qos on qos.offer_id = ql.offer_id
      where qos.user_id = auth.uid()
    )
  );
