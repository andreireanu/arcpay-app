## Arc Pay App

---

## Key Flows

### Registration

Nothing is written to the DB until the blockchain tx confirms.

1. Frontend calls `sol-authorize` Edge Function (JWT-authenticated) → receives a backend-signed token (signature, expiry, backend public key)
2. Frontend builds a transaction with two instructions:
   - ix[0]: ed25519 precompile — verifies the backend signature before the program runs
   - ix[1]: `register` instruction — creates the `UserProfile` PDA on-chain, emits `WalletRegistered` event with the user's UUID
3. Helius picks up the `WalletRegistered` event → `sol-register-webhook` writes the row to `qr_generator_sellers`
4. Frontend Realtime listener on `qr_generator_sellers` resolves → UI updates to registered state

---

### Create Offer

The offer is written to the DB **before** the blockchain tx, because a UUID is needed as a parameter to the on-chain instruction.

1. Frontend inserts into `qr_offers_data` (public metadata: name, description, price) and `qr_offers_sellers` (private: user_id, seller_wallet) → gets UUID back
2. Frontend starts Realtime listener on `qr_listings` for that UUID
3. Frontend sends `create_listing(price_lamports, uuid)` tx on-chain
4. Helius picks up `ListingCreated` event → `sol-listing-webhook`:
   - Inserts `{ offer_id, listing_pda }` into `qr_listings`
   - Generates QR code for `<SITE_URL>/pay/<offer_id>` → uploads to Supabase Storage
   - Updates `qr_listings.qr_url` with the Storage URL
   - Updates `qr_offers_data.status = 'active'`
5. Frontend Realtime listener resolves when `qr_listings` row appears → QR code displayed

If step 3 fails, `qr_offers_data` and `qr_offers_sellers` rows remain with `status = 'unlisted'` — surfaced on the dashboard with a retry option.
