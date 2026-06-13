import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function getDiscriminator(eventName: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`event:${eventName}`),
  );
  return new Uint8Array(hash, 0, 8);
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function bytesToUuid(bytes: Uint8Array): string {
  const h = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Settle webhook: consumes the two admin_settle_offer events.
//   OfferBought   — escrow paid to the seller; flip the counter offer to
//                   confirmed and run the business side effects exactly once
//                   (the conditional status update is the idempotency guard).
//   OfferRefunded — escrow returned to the buyer (listing cancel / expiry);
//                   the cancel webhook already set the status, here we record
//                   that the record was closed and rent returned.
Deno.serve(async (req) => {
  const secret = Deno.env.get("HELIUS_WEBHOOK_SECRET");
  if (secret && req.headers.get("authorization") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const transactions = Array.isArray(payload) ? payload : [payload];
  console.log("sol-refund-webhook received", transactions.length, "tx(s)");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const boughtDisc = await getDiscriminator("OfferBought");
  const refundedDisc = await getDiscriminator("OfferRefunded");

  for (const tx of transactions) {
    const logs: string[] = tx.meta?.logMessages ?? tx.logs ?? [];
    const txSignature: string =
      tx.signature ?? tx.transaction?.signatures?.[0] ?? "";

    for (const log of logs) {
      if (!log.startsWith("Program data: ")) continue;

      const bytes = Uint8Array.from(
        atob(log.slice("Program data: ".length)),
        (c) => c.charCodeAt(0),
      );

      if (bytes.length < 8) continue;
      const disc = bytes.slice(0, 8);

      // OfferBought: 8 disc + 16 uuid + 32 buyer + 32 seller + 8 seller_amount + 8 fee_amount + 8 timestamp = 112 bytes
      if (bytes.length >= 112 && arraysEqual(disc, boughtDisc)) {
        const ephemeralUuid = bytesToUuid(bytes.slice(8, 24));
        console.log("offer_bought event", ephemeralUuid);

        // Conditional flip = exactly-once: a duplicate delivery matches 0 rows.
        const { data: settled, error } = await supabase
          .from("qr_counteroffers")
          .update({
            status: "confirmed",
            confirmed_at: new Date().toISOString(),
            rent_returned: true,
            settle_tx_signature: txSignature,
          })
          .eq("ephemeral_id", ephemeralUuid)
          .eq("status", "active")
          .select("id, offer_id, buyer_wallet")
          .maybeSingle();

        if (error) {
          console.error("confirm update error", ephemeralUuid, error);
          continue;
        }
        if (!settled) {
          console.warn("duplicate delivery or unknown record, skipping", ephemeralUuid);
          continue;
        }

        const { error: qtyError } = await supabase.rpc(
          "increment_offer_quantity_sold_by",
          { p_offer_id: settled.offer_id, p_amount: 1 },
        );
        if (qtyError) console.error("quantity increment error", qtyError);

        // Mark the buyer confirmed (their row was inserted with confirmed=false
        // when they submitted the counter offer). Pure wallet-keyed flip.
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
        if (hiddenDelError)
          console.error("seller_state cleanup error", hiddenDelError);

        console.log("counter offer confirmed", settled.id, ephemeralUuid);
        continue;
      }

      // OfferRefunded: 8 disc + 16 uuid + 32 buyer + 32 seller + 8 amount + 8 timestamp = 104 bytes
      if (bytes.length >= 104 && arraysEqual(disc, refundedDisc)) {
        const ephemeralUuid = bytesToUuid(bytes.slice(8, 24));
        console.log("offer_refunded event", ephemeralUuid);

        const { error } = await supabase
          .from("qr_counteroffers")
          .update({ rent_returned: true, settle_tx_signature: txSignature })
          .eq("ephemeral_id", ephemeralUuid);

        if (error)
          console.error("rent_returned update error", ephemeralUuid, error);
        else console.log("rent_returned set for ephemeral", ephemeralUuid);
      }
    }
  }

  return new Response("ok", { status: 200 });
});
