-- On-chain confirmation record — written by webhook after ListingCreated event
create table qr_listings (
  offer_id uuid primary key references qr_offers_data(id) on delete cascade,
  listing_pda text not null,
  qr_url text,
  created_at timestamptz default now()
);

alter table qr_listings enable row level security;

create policy "listings are public"
  on qr_listings for select
  to anon, authenticated
  using (true);

alter publication supabase_realtime add table qr_listings;
