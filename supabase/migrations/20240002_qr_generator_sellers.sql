create table qr_generator_sellers (
  id text primary key,            -- UserProfile PDA address (base58)
  wallet_address text not null unique,
  user_id uuid references auth.users(id),
  registered_at timestamptz default now()
);
