-- products: authenticated users can read
alter table products enable row level security;

create policy "authenticated users can read products"
  on products for select
  to authenticated
  using (true);

-- qr_generator_sellers: no client access
alter table qr_generator_sellers enable row level security;
