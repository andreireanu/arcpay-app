import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// A single counter offer the rule selected for settlement. Carries both chains'
// settle keys (ephemeral_id/buyer_wallet for Solana, sui_object_id for Sui) so
// each webhook maps it to its own admin_settle_offer item shape.
export interface AutoAcceptRow {
  id: string;
  ephemeral_id: string;
  sui_object_id: string | null;
  buyer_wallet: string;
  fee_amount: number;
  seller_amount: number;
}

export interface AutoAcceptDecision {
  sellerWallet: string;
  rows: AutoAcceptRow[];
  achievedAvg: number;
}

// Evaluate the auto-accept rule for an offer after a new counter offer landed.
// Returns the best `quantity` active counter offers to settle to the seller when
// the rule is armed and their average price (seller_amount + fee_amount) meets
// the seller's threshold; otherwise null. Chain-agnostic — the caller runs the
// chain-specific admin_settle_offer with the returned rows.
export async function evaluateAutoAccept(
  supabase: SupabaseClient,
  offerId: string,
): Promise<AutoAcceptDecision | null> {
  const { data: rule } = await supabase
    .from("qr_auto_accept")
    .select("quantity, avg_price, triggered_at")
    .eq("offer_id", offerId)
    .maybeSingle();

  // No rule, or it already fired (one-shot — disarmed once triggered_at is set).
  if (!rule || rule.triggered_at) return null;

  const { data: offer } = await supabase
    .from("qr_offers")
    .select("seller_wallet, unlimited, quantity, quantity_sold")
    .eq("id", offerId)
    .maybeSingle();

  if (!offer?.seller_wallet) return null;

  // Cap the batch at remaining stock for limited offers, so auto-accept never
  // oversells. Unlimited offers take the full requested count.
  let target = rule.quantity as number;
  if (!offer.unlimited) {
    const remaining = offer.quantity - offer.quantity_sold;
    if (remaining <= 0) return null;
    target = Math.min(target, remaining);
  }

  const { data: active } = await supabase
    .from("qr_counteroffers")
    .select("id, ephemeral_id, sui_object_id, buyer_wallet, fee_amount, seller_amount")
    .eq("offer_id", offerId)
    .eq("status", "active");

  // Need at least `target` active offers to fill the batch.
  if (!active || active.length < target) return null;

  const top = [...active]
    .sort(
      (a, b) =>
        b.seller_amount + b.fee_amount - (a.seller_amount + a.fee_amount),
    )
    .slice(0, target);

  const totalSum = top.reduce(
    (sum, co) => sum + co.seller_amount + co.fee_amount,
    0,
  );
  const achievedAvg = Math.floor(totalSum / target);

  if (achievedAvg < rule.avg_price) return null;

  return { sellerWallet: offer.seller_wallet, rows: top as AutoAcceptRow[], achievedAvg };
}

// Stamp the rule as fired (one-shot guard) and record the average actually
// achieved — keeps the row as an audit trail rather than deleting it.
export async function markAutoAcceptTriggered(
  supabase: SupabaseClient,
  offerId: string,
  achievedAvg: number,
): Promise<void> {
  const { error } = await supabase
    .from("qr_auto_accept")
    .update({
      triggered_price: achievedAvg,
      triggered_at: new Date().toISOString(),
    })
    .eq("offer_id", offerId);
  if (error) console.error("auto-accept trigger stamp error", offerId, error);
}
