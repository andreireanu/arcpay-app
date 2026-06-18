import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Accepts offer_id as a uuid string, a 32-char hex string, or a 16-element byte
// array, and normalizes to the canonical uuid stored in qr_offers.id.
function normalizeOfferId(input: unknown): string {
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
  throw new Error("offer_id must be a uuid, hex string, or byte array");
}

function hexToUuid(hex: string): string {
  if (hex.length !== 32)
    throw new Error(`offer_id must be 16 bytes, got ${hex.length / 2}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

Deno.serve(async (req) => {
  // Server-to-server call from our own indexer — authenticate with a shared
  // secret (the JWT gateway check is off via config.toml).
  const secret = Deno.env.get("SUI_WEBHOOK_SECRET");
  if (secret && req.headers.get("authorization") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event;
  try {
    event = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const txSignature: string = event.tx_digest ?? "";
  if (!txSignature) return new Response("Missing tx_digest", { status: 400 });

  let offerId: string;
  try {
    offerId = normalizeOfferId(event.offer_id);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Bad offer_id", {
      status: 400,
    });
  }

  const buyerWallet: string = event.buyer ?? "";
  const sellerAmount = Number(event.seller_amount);
  const feeAmount = Number(event.fee_amount);
  if (
    !buyerWallet ||
    !Number.isFinite(sellerAmount) ||
    !Number.isFinite(feeAmount)
  ) {
    return new Response("Missing or invalid fields", { status: 400 });
  }

  console.log(
    "sui-buy-webhook buy_completed",
    offerId,
    "buyer",
    buyerWallet,
    "digest",
    txSignature,
  );

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { error: txError } = await supabase.from("qr_transactions").insert({
    offer_id: offerId,
    buyer_wallet: buyerWallet,
    tx_signature: txSignature,
    seller_amount: sellerAmount,
    fee_amount: feeAmount,
    quantity: 1,
    chain: "sui",
  });
  if (txError) {
    // code 23505 = unique_violation: the indexer re-delivered this digest, safe to ignore.
    if (txError.code === "23505") {
      console.warn("duplicate delivery, skipping", txSignature);
      return new Response("ok (duplicate)", { status: 200 });
    }
    console.error("transaction insert error", txError);
    return new Response("Internal error", { status: 500 });
  }

  const { error: qtyError } = await supabase.rpc(
    "increment_offer_quantity_sold_by",
    {
      p_offer_id: offerId,
      p_amount: 1,
    },
  );
  if (qtyError) console.error("quantity increment error", qtyError);
  else console.log("buy recorded", offerId, txSignature);

  // Oversell containment: an auth is replayable until expiry, so on-chain sales
  // can exceed stock. Keep the count truthful and make any oversell loud so it
  // can be refunded manually.
  const { data: offerRow } = await supabase
    .from("qr_offers")
    .select("unlimited, quantity, quantity_sold")
    .eq("id", offerId)
    .maybeSingle();
  if (
    offerRow &&
    !offerRow.unlimited &&
    offerRow.quantity_sold > offerRow.quantity
  ) {
    console.error(
      "OVERSOLD offer",
      offerId,
      "sold",
      offerRow.quantity_sold,
      "of",
      offerRow.quantity,
      "— buy tx",
      txSignature,
      "buyer",
      buyerWallet,
      "needs manual refund",
    );
  }

  // Flip the buyer's row to confirmed (inserted confirmed=false at buy init).
  const { error: buyerError } = await supabase
    .from("buyers")
    .update({ confirmed: true })
    .eq("wallet_address", buyerWallet);
  if (buyerError) console.error("buyer confirm error", buyerError);

  return new Response("ok", { status: 200 });
});
