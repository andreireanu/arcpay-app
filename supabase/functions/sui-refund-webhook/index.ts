import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// Accepts a uuid as a uuid string, a 32-char hex string, or a 16-element byte
// array, and normalizes to the canonical uuid stored in the DB.
function normalizeUuid(input: unknown): string {
  if (Array.isArray(input)) {
    const hex = input
      .map((b) => Number(b).toString(16).padStart(2, "0"))
      .join("");
    return hexToUuid(hex);
  }
  if (typeof input === "string") {
    if (input.includes("-")) return input.toLowerCase();
    return hexToUuid(input.replace(/^0x/, ""));
  }
  throw new Error("uuid must be a uuid, hex string, or byte array");
}

function hexToUuid(hex: string): string {
  if (hex.length !== 32)
    throw new Error(`uuid must be 16 bytes, got ${hex.length / 2}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Settle webhook: consumes the two admin_settle_offer events the backend emits.
//   OfferBought   — escrow (minus fee) paid to the seller; flip the counter offer
//                   to confirmed and run the business side effects exactly once
//                   (the conditional status update is the idempotency guard).
//   OfferRefunded — escrow returned to the buyer (seller cancel / expiry); the
//                   cancel webhook already set the status, here we just record the
//                   settling tx digest. No rent concept on Sui, so nothing else.
Deno.serve(async (req) => {
  // Server-to-server call from our own indexer — authenticate with a shared
  // secret (the JWT gateway check is off via config.toml).
  const secret = Deno.env.get("SUI_WEBHOOK_SECRET");
  if (secret && req.headers.get("authorization") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // The indexer tags each decoded event with its Move struct name.
  if (payload.event === "OfferBought") {
    return handleBought(supabase, payload);
  }
  if (payload.event === "OfferRefunded") {
    return handleRefunded(supabase, payload);
  }
  return new Response("Unknown event", { status: 400 });
});

// OfferBought: the backend settled an accepted counter offer to the seller. Flip
// it to confirmed and run the business side effects exactly once.
async function handleBought(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<Response> {
  let ephemeralUuid: string;
  try {
    ephemeralUuid = normalizeUuid(payload.uuid);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Bad uuid", {
      status: 400,
    });
  }

  const txDigest = typeof payload.tx_digest === "string" ? payload.tx_digest : "";
  // The settling tx carries whether the auto-accept rule triggered it (vs a
  // seller manual accept). Emit-only on chain; here it picks the final status.
  const status = payload.auto === true ? "auto_confirmed" : "confirmed";
  console.log("sui-refund-webhook offer_bought", ephemeralUuid, "digest", txDigest, "auto", payload.auto === true);

  // Conditional flip = exactly-once: a duplicate delivery matches 0 rows.
  const { data: settled, error } = await supabase
    .from("qr_counteroffers")
    .update({
      status,
      confirmed_at: new Date().toISOString(),
      returned: true,
      settle_tx_signature: txDigest,
    })
    .eq("ephemeral_id", ephemeralUuid)
    .eq("chain", "sui")
    .eq("status", "active")
    .select("id, offer_id, buyer_wallet")
    .maybeSingle();

  if (error) {
    console.error("confirm update error", ephemeralUuid, error);
    return new Response("Internal error", { status: 500 });
  }
  if (!settled) {
    console.warn("duplicate delivery or unknown record, skipping", ephemeralUuid);
    return new Response("ok (duplicate)", { status: 200 });
  }

  const { error: qtyError } = await supabase.rpc(
    "increment_offer_quantity_sold_by",
    { p_offer_id: settled.offer_id, p_amount: 1 },
  );
  if (qtyError) console.error("quantity increment error", qtyError);

  // Mark the buyer confirmed (their row was inserted with confirmed=false when
  // they submitted the counter offer). Pure wallet-keyed flip.
  const { error: buyerError } = await supabase
    .from("buyers")
    .update({ confirmed: true })
    .eq("wallet_address", settled.buyer_wallet);
  if (buyerError) console.error("buyer confirm error", buyerError);

  // Drop any seller hidden-marker for this now-confirmed counter offer.
  const { error: hiddenDelError } = await supabase
    .from("qr_counteroffers_seller_state")
    .delete()
    .eq("counteroffer_id", settled.id);
  if (hiddenDelError) console.error("seller_state cleanup error", hiddenDelError);

  console.log("counter offer confirmed", settled.id, ephemeralUuid);
  return new Response("ok", { status: 200 });
}

// OfferRefunded: the backend returned escrow to the buyer and admin_settle_offer
// deleted the Offer object. The cancel webhook already set the status; record the
// settling tx digest and mark the escrow returned/closed.
async function handleRefunded(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<Response> {
  let ephemeralUuid: string;
  try {
    ephemeralUuid = normalizeUuid(payload.uuid);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Bad uuid", {
      status: 400,
    });
  }

  const txDigest = typeof payload.tx_digest === "string" ? payload.tx_digest : "";
  console.log("sui-refund-webhook offer_refunded", ephemeralUuid, "digest", txDigest);

  const { error } = await supabase
    .from("qr_counteroffers")
    .update({
      returned: true,
      settle_tx_signature: txDigest,
      confirmed_at: new Date().toISOString(),
    })
    .eq("ephemeral_id", ephemeralUuid)
    .eq("chain", "sui");

  if (error) {
    console.error("returned update error", ephemeralUuid, error);
    return new Response("Internal error", { status: 500 });
  }

  console.log("settle_tx_signature set for ephemeral", ephemeralUuid);
  return new Response("ok", { status: 200 });
}
