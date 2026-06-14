-- ─── qr_transactions: let buyers read their own purchases ────────────────────
-- Until now qr_transactions had only a seller SELECT policy (a seller may read
-- transactions on their own offers). The buyer dashboard needs the mirror: a
-- buyer may read the rows where they are the buyer, for the "Items bought"
-- section and the Transactions tab.
--
-- Gate on app_metadata.wallet_address (written only by the service role during
-- auth-exchange), NOT user_metadata (end-user editable) — same rule as the
-- existing "buyers can read own counteroffers" policy.
--
-- This also makes the existing qr_seller_transactions view (security_invoker)
-- return the buyer's own buys + confirmed counter offers when a buyer queries
-- it, since the view simply inherits the caller's RLS on the underlying tables.
CREATE POLICY "buyers can read own transactions"
  ON public.qr_transactions FOR SELECT TO authenticated
  USING (
    buyer_wallet = (auth.jwt() -> 'app_metadata' ->> 'wallet_address')
  );
