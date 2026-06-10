import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Connection, Keypair, PublicKey } from "npm:@solana/web3.js@1";
import {
  BATCH_SIZE,
  NETWORK_FEE_PER_TX,
  sendAdminRefunds,
} from "../_sol-shared/sendAdminRefunds.ts";

async function offerAcceptedDiscriminator(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("event:OfferAccepted"),
  );
  return new Uint8Array(hash, 0, 8);
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function bytesToUuid(bytes: Uint8Array): string {
  const h = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("HELIUS_WEBHOOK_SECRET");
  if (secret && req.headers.get("authorization") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const transactions = Array.isArray(payload) ? payload : [payload];
  console.log("sol-accept-webhook received", transactions.length, "tx(s)");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const disc = await offerAcceptedDiscriminator();

  for (const tx of transactions) {
    const logs: string[] = tx.meta?.logMessages ?? tx.logs ?? [];

    for (const log of logs) {
      if (!log.startsWith("Program data: ")) continue;

      const bytes = Uint8Array.from(
        atob(log.slice("Program data: ".length)),
        (c) => c.charCodeAt(0),
      );

      // OfferAccepted: 8 disc + 16 uuid + 32 seller + 8 seller_amount + 8 fee_amount + 8 timestamp = 80 bytes
      if (bytes.length < 80 || !arraysEqual(bytes.slice(0, 8), disc)) continue;

      const ephemeralId = bytesToUuid(bytes.slice(8, 24));
      console.log("offer_accepted event", ephemeralId);

      // Fetch the witness row to get the list of counter offer IDs
      const { data: witness, error: witnessError } = await supabase
        .from("qr_accepted_counter")
        .select("id, offers, status")
        .eq("id", ephemeralId)
        .maybeSingle();

      if (witnessError || !witness) {
        console.error(
          "qr_accepted_counter lookup failed",
          ephemeralId,
          witnessError,
        );
        continue;
      }

      if (witness.status === "confirmed") {
        console.warn("duplicate webhook delivery, skipping", ephemeralId);
        continue;
      }

      const counterOfferIds: string[] = witness.offers;

      // Mark each counter offer as confirmed
      const { error: coUpdateError } = await supabase
        .from("qr_counteroffers")
        .update({ status: "confirmed" })
        .in("id", counterOfferIds);

      if (coUpdateError) {
        console.error("qr_counteroffers update error", coUpdateError);
        continue;
      }

      // Mark the witness row as confirmed
      const { error: witnessUpdateError } = await supabase
        .from("qr_accepted_counter")
        .update({ status: "confirmed" })
        .eq("id", ephemeralId);

      if (witnessUpdateError) {
        console.error("qr_accepted_counter update error", witnessUpdateError);
        continue;
      }

      // Fetch the confirmed counter offers' details (offer_id for the quantity
      // bump, ephemeral_id + buyer_wallet for the rent refund).
      const { data: counteroffers_data, error: offerIdError } = await supabase
        .from("qr_counteroffers")
        .select("ephemeral_id, buyer_wallet, offer_id")
        .in("id", counterOfferIds);

      if (offerIdError || !counteroffers_data || counteroffers_data.length === 0) {
        console.error("qr_counteroffers details fetch error", offerIdError);
        continue;
      }

      const { error: qtyError } = await supabase.rpc(
        "increment_offer_quantity_sold_by",
        {
          p_offer_id: counteroffers_data[0].offer_id,
          p_amount: counterOfferIds.length,
        },
      );
      if (qtyError) console.error("quantity increment error", qtyError);

      // Mark the accepted buyers confirmed (their rows were inserted with
      // confirmed=false when they submitted the counter offer). Pure wallet-keyed
      // flip — no user_id. Dedupe in case one buyer had multiple accepted offers.
      const buyerWallets = [
        ...new Set(counteroffers_data.map((co) => co.buyer_wallet)),
      ];
      const { error: buyerError } = await supabase
        .from("buyers")
        .update({ confirmed: true })
        .in("wallet_address", buyerWallets);
      if (buyerError) console.error("buyer confirm error", buyerError);

      // Drop any seller hidden-markers for these now-confirmed counter offers
      // (they're leaving the active list anyway).
      const { error: hiddenDelError } = await supabase
        .from("qr_counteroffers_seller_state")
        .delete()
        .in("counteroffer_id", counterOfferIds);
      if (hiddenDelError)
        console.error("seller_state cleanup error", hiddenDelError);

      // Return the offer_record rent to each buyer. vault = None (sellerWallet
      // omitted): the offer amount already moved to the seller on accept, so only
      // the rent is refunded. Emits OfferAdminRefunded → sol-refund-webhook
      // flips rent_returned = true.
      const connection = new Connection(Deno.env.get("SOLANA_RPC_URL")!, {
        commitment: "confirmed",
        fetch,
      });
      const backendKeypair = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(Deno.env.get("BACKEND_KEYPAIR")!)),
      );
      const programId = new PublicKey(Deno.env.get("PROGRAM_ID")!);

      const backendBalance = await connection.getBalance(
        backendKeypair.publicKey,
      );
      const numBatches = Math.ceil(counteroffers_data.length / BATCH_SIZE);
      const requiredLamports = numBatches * NETWORK_FEE_PER_TX;
      if (backendBalance < requiredLamports) {
        console.error(
          "backend wallet underfunded — rent refunds will fail",
          backendKeypair.publicKey.toBase58(),
          "balance",
          backendBalance,
          "needed(approx)",
          requiredLamports,
        );
      }

      const { signatures, errors } = await sendAdminRefunds(
        connection,
        backendKeypair,
        programId,
        counteroffers_data.map((co) => ({
          ephemeralId: co.ephemeral_id,
          buyerWallet: co.buyer_wallet,
        })),
      );

      if (signatures.length)
        console.log("rent refunds sent", ephemeralId, signatures);
      if (errors.length) console.error("rent refund errors", ephemeralId, errors);

      console.log(
        "confirmed accepted_counter",
        ephemeralId,
        "counter_offers",
        counterOfferIds,
      );
    }
  }

  return new Response("ok", { status: 200 });
});
