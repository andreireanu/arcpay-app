# ArcPay - App

> ArcPay makes accepting, moving, and managing crypto effortless across Sui and
> Solana, with powerful features for every part of your workflow.

The web app for the ArcPay peer-to-peer marketplace: sellers list items and share
a QR code, buyers scan it and pay in **SUI or SOL**, with an escrow flow for
offers that aren't a straight "buy now". It is a React single-page app that builds
and submits the on-chain transactions itself, while an off-chain Supabase backend
orchestrates the order book and authorizes every privileged action.

This is one of three repos that make up ArcPay:

| Repo | Role |
|------|------|
| `arcpay-sui` / `arcpay-solana` | The on-chain contracts (Move / Anchor) that hold escrow and enforce backend-approved payouts. |
| `arcpay-sui-events-indexer` | Streams chain events and forwards them to the Supabase webhooks. |
| **`arcpay-app`** (this repo) | The buyer/seller UI **and** the Supabase Edge Functions (authorizers + webhooks). |

## Architecture

The browser never trusts itself with money: it builds a transaction, but the
backend must co-sign it (an ed25519 signature the contract verifies on-chain), and
the database is only ever written from the chain, via the indexer. The app reads
that mirrored state back over Supabase Realtime.

```
  ┌───────────────────────────────────────────────────────────────┐
  │ browser (this app): React + Vite UI + Dynamic wallet           │
  │ (Slush on Sui / Phantom on Solana / embedded email)            │
  └───────────────────────────────────────────────────────────────┘
       │
       │ 1. authorize (actions that move funds): an Edge Function returns
       │    a backend ed25519 signature + amounts. Some flows need none -
       │    e.g. a buyer reclaiming their own escrow.
       │ 2. build, sign & submit the transaction (wallet)
       ▼
  Sui / Solana network
       │
       │ 3. on-chain event
       ▼
  arcpay indexer
       │
       │ 4. HTTPS POST
       ▼
  Supabase Edge Function webhooks   (the only writer of order/escrow rows)
       │
       │ 5. DB writes
       ▼
  Supabase Postgres
       │
       │ 6. Realtime push
       ▼
  browser: UI reflects the confirmed row
```

So a purchase is: **authorize** (backend signs) -> **sign & submit** (wallet) ->
**index** (chain event -> webhook) -> **write** (DB) -> **Realtime** (UI updates).
The UI only ever optimistically previews; the row it shows becomes authoritative
once the webhook writes it.

## Why this design

- **Chain-agnostic UI, chain-specific edges.** Pages never know which chain they
  are on. They call one set of actions in `src/dispatcher/actions.ts`, which is the
  single place that branches Sui vs Solana and hands off to `src/sui/` or
  `src/solana/`. Adding a chain means adding instruction builders, not touching
  pages.
- **Supabase isolation.** Every database call lives under `src/supabase/`. No
  component or hook imports the Supabase client directly, so the backend stays
  replaceable.
- **Backend-authorized, browser-submitted.** The browser builds and pays for the
  transaction, but the contract only moves funds for an order the backend signed.
  Order matching, pricing, and identity stay off-chain (cheap and private); the
  chain enforces approval.
- **The DB is a chain mirror.** The browser is never allowed to write order or
  escrow tables. Those rows are written only by webhooks reacting to confirmed
  on-chain events, so the UI and the chain can't disagree.

## Tech stack

| Layer | Technology |
|-------|------------|
| UI | React 19, Vite, TypeScript (strict), Tailwind CSS v4, React Router |
| Wallets + auth | Dynamic.xyz - Slush (Sui), Phantom (Solana), and embedded email (WaaS) wallets |
| Sui | `@mysten/sui` (transaction building, RPC) |
| Solana | Anchor (`@coral-xyz/anchor`), `@solana/web3.js` |
| Backend | Supabase - Postgres, Auth, Realtime, Storage, Edge Functions (Deno) |
| QR codes | `qrcode` |

## Authentication

Login is handled by Dynamic. A user signs in with an email (which mints an
embedded WaaS wallet) or by connecting an extension wallet (Slush on Sui, Phantom
on Solana). The chosen chain scopes the login flow.

To talk to the database under row-level security, the app exchanges the Dynamic
session for a Supabase one: it POSTs the Dynamic JWT to the **`auth-exchange`**
Edge Function, which verifies it and returns a Supabase access/refresh token tied
to the wallet address. From then on, RLS scopes every read to that wallet.

## Backend authorization

Privileged actions carry an ed25519 signature from the backend. Before building a
transaction, the app calls an **authorize** Edge Function, which signs the exact
canonical byte layout the contract will re-derive and verify on-chain. The
signature, amounts, and expiry come back and are embedded in the transaction (as a
Move call argument on Sui, or a prepended ed25519-program instruction on Solana).

| Authorizer | Used for |
|------------|----------|
| `buy-authorize` | Instant buy - signs `(buyer, seller, offer_id, amount, fee, expiry)`. |
| `counteroffer-authorize` | Opening an escrowed buyer offer. |
| `seller-authorize` | Seller-side actions (e.g. cancelling a listing). |
| `auth-exchange` | Exchanges a Dynamic JWT for a Supabase session (not a tx signer). |

## Webhooks

The Edge Functions that the indexer POSTs to also live here. They are the only
writers of the order/escrow tables, and they dedup on the transaction
digest/signature (the indexer delivers at-least-once). The Sui and Solana
variants share logic and write the same rows.

| Webhook (Sui / Solana) | On-chain event | Effect |
|------------------------|----------------|--------|
| `*-buy-webhook` | `BuyCompleted` | Records a direct purchase in `qr_transactions`. |
| `*-counteroffer-webhook` | `OfferCreated` | Records a buyer counter offer; runs the auto-accept rule. |
| `*-accept-webhook` | `OfferAccepted` | Marks a counter offer accepted by the seller. |
| `*-cancel-webhook` | `Buyer/SellerOfferCanceled` | Flips status to canceled and refunds active escrow. |
| `*-refund-webhook` | `OfferBought` / `OfferRefunded` | Settlement: pay the seller, or refund the buyer. |

## Core flows

### Instant buy

1. The buyer opens `/pay/:offerId` (a scanned QR or shared link) and clicks BUY.
2. The app calls `buy-authorize` -> backend-signed approval + amounts.
3. `dispatcher/actions.ts` -> the offer's chain builder (`sui/instructions/buy` or
   `solana/instructions/buy`) assembles the payment + the backend signature; the
   wallet signs and the app submits.
4. The indexer sees `BuyCompleted` -> `*-buy-webhook` writes `qr_transactions`.
5. Realtime drops the new row into the buyer's and seller's dashboards.

### Escrowed offer (counter offer)

"Offer" means two things: the seller's off-chain listing, and the buyer's
on-chain escrow (a *counter offer*) created in response. They are never linked
on-chain - only the backend knows which answers which.

1. The buyer submits a price -> `counteroffer-authorize` -> the chain builder locks
   funds in a new escrow object/PDA. `*-counteroffer-webhook` records it.
2. The seller accepts (or an auto-accept rule fires), or the buyer cancels.
3. The backend settles via the contract's admin path -> `*-refund-webhook` either
   pays the seller (`OfferBought`) or refunds the buyer (`OfferRefunded`) and flips
   the row's status. Realtime updates both dashboards.

## Routes

| Route | Page |
|-------|------|
| `/login` | Sign in / connect wallet (Dynamic). |
| `/pay/:offerId` | Public checkout for one offer - buy or make a counter offer. |
| `/seller` | Seller dashboard: products, offers, transactions. |
| `/buyer` | Buyer dashboard: items bought, active/canceled offers, transactions. |
| `/products` | Create and manage listings. |
| `/offer/:offerId` | A single offer's detail and counter offers. |
| `/transactions` | Full transaction history. |

## Project layout

```
src/
  pages/         # one component per route (thin - rendering + interaction only)
  components/    # shared UI (modals, grids, lists, header)
  dispatcher/    # actions.ts - the single chain-agnostic tx entry point
  sui/           # Sui client + instruction builders
  solana/        # Solana (Anchor) client, IDL + instruction builders
  supabase/      # ALL database access + authorize/exchange calls (isolated here)
  context/       # auth + active-chain React context
  hooks/         # useAuth, useEscapeKey, ...
  config/env.ts  # the only place env vars are read
  types/         # shared DB entity types
  utils/         # pure helpers (format, qr, offer status)
supabase/
  functions/     # Edge Functions: authorize + auth-exchange + the *-webhook handlers
```

## Environment

All env access goes through `src/config/env.ts`; never read `import.meta.env`
elsewhere. Create `.env.local` (devnet/testnet) from the keys below; never commit
secrets.

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_DYNAMIC_ENV_ID=

# Sui
VITE_SUI_NETWORK=testnet
VITE_SUI_PACKAGE_ID=
VITE_SUI_CONFIG_ID=

# Solana
VITE_SOLANA_NETWORK=devnet
VITE_SOLANA_RPC_URL=
VITE_PROGRAM_ID=

# Buyer cost display (optional; sensible defaults in env.ts)
VITE_RETURNABLE_FEE_LAMPORTS=
VITE_TX_COST_LAMPORTS=
VITE_SUI_TX_COST_MIST=
```

Edge Function secrets (backend signing keys, service role key) are configured in
the Supabase project, never in the app.

## Run

```bash
npm install
npm run dev      # Vite dev server
npm run build    # tsc -b + vite build
npm run preview  # serve the production build
npm run lint
```

Edge Functions are deployed with the Supabase CLI from `supabase/functions/`.
Webhook functions run with JWT verification disabled (they authenticate the
indexer with a shared secret instead); the authorize functions keep JWT
verification on.
