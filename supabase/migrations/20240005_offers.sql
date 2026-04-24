-- Public offer metadata — readable by anyone (pay page)
create table qr_offers_data (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  price_lamports bigint not null,
  status text not null default 'unlisted',
  created_at timestamptz default now()
);

alter table qr_offers_data enable row level security;

create policy "offers are public"
  on qr_offers_data for select
  to anon, authenticated
  using (true);

create policy "authenticated users can create offers"
  on qr_offers_data for insert
  to authenticated
  with check (true);

-- Private ownership — links offer to user account and wallet
create table qr_offers_sellers (
  offer_id uuid primary key references qr_offers_data(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  seller_wallet text not null
);

alter table qr_offers_sellers enable row level security;

create policy "users manage own offer ownership"
  on qr_offers_sellers for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
