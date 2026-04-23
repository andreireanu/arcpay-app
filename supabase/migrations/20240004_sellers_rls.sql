-- Allow authenticated users to read their own seller row
create policy "users can read own registration"
  on qr_generator_sellers for select
  to authenticated
  using (auth.uid() = user_id);
