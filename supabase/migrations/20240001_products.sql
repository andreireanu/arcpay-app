create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  image_url text,
  created_at timestamptz default now()
);

insert into products (name, description, image_url) values (
  'QR Generator',
  'Create QR codes for your product listings and accept SOL payments on-chain.',
  'https://twjaooacmrveivxxfwyx.supabase.co/storage/v1/object/public/assets/qr.jpg'
);
