import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Connection,
  Keypair,
  PublicKey,
} from "npm:@solana/web3.js@1";
import {
  BATCH_SIZE,
  NETWORK_FEE_PER_TX,
  sendAdminSettles,
} from "../_sol-shared/sendAdminSettles.ts";

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
  const h = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  let n = bytes.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  const chars: string[] = [];
  while (n > 0n) {
    chars.unshift(BASE58[Number(n % 58n)]);
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    chars.unshift("1");
  }
  return chars.join("");
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("HELIUS_WEBHOOK_SECRET");
  if (secret && req.headers.get("authorization") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const transactions = Array.isArray(payload) ? payload : [payload];
  console.log("sol-cancel-webhook received", transactions.length, "tx(s)");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const buyerDisc = await getDiscriminator("BuyerOfferCanceled");
  const sellerDisc = await getDiscriminator("SellerOfferCanceled");

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

      // BuyerOfferCanceled: 8 disc + 16 uuid + 32 buyer + 32 seller + 8 amount + 8 timestamp = 104 bytes
      if (bytes.length >= 104 && arraysEqual(disc, buyerDisc)) {
        const ephemeralUuid = bytesToUuid(bytes.slice(8, 24));
        console.log("buyer_cancel event", ephemeralUuid);

        const { data: canceledRows, error } = await supabase
          .from("qr_counteroffers")
          .update({
            status: "buyer_canceled",
            returned: true,
            settle_tx_signature: txSignature,
            confirmed_at: new Date().toISOString(),
          })
          .eq("ephemeral_id", ephemeralUuid)
          .select("id");

        if (error)
          console.error("buyer_canceled update error", ephemeralUuid, error);
        else {
          console.log("buyer_canceled", ephemeralUuid);
          // Drop any seller hidden-marker for this now-canceled counter offer.
          if (canceledRows && canceledRows.length > 0) {
            const { error: hiddenDelError } = await supabase
              .from("qr_counteroffers_seller_state")
              .delete()
              .in("counteroffer_id", canceledRows.map((r) => r.id));
            if (hiddenDelError)
              console.error("seller_state cleanup error", hiddenDelError);
          }
        }
        continue;
      }

      // SellerOfferCanceled: 8 disc + 16 offer_id + 32 seller + 8 timestamp = 64 bytes
      if (bytes.length >= 64 && arraysEqual(disc, sellerDisc)) {
        const offerIdUuid = bytesToUuid(bytes.slice(8, 24));
        const sellerWallet = base58Encode(bytes.slice(24, 56));
        console.log("seller_cancel event", offerIdUuid, "seller", sellerWallet);

        // The event's seller field is the tx signer (a Signer account in the
        // program), so matching it against the listing's owner verifies the
        // cancel was signed by that owner. Anyone can emit this event with any
        // offer_id — without this check a spoofed event marks someone else's
        // listing canceled in the DB.
        const { data: offerRow, error: offerLookupError } = await supabase
          .from("qr_offers")
          .select("seller_wallet")
          .eq("id", offerIdUuid)
          .maybeSingle();

        if (offerLookupError || !offerRow) {
          console.error("qr_offers lookup failed", offerIdUuid, offerLookupError);
          continue;
        }
        if (offerRow.seller_wallet !== sellerWallet) {
          console.warn(
            "spoofed seller_cancel ignored",
            offerIdUuid,
            "signer",
            sellerWallet,
          );
          continue;
        }

        const { data: counterOffers, error: fetchError } = await supabase
          .from("qr_counteroffers")
          .select("id, ephemeral_id, buyer_wallet")
          .eq("offer_id", offerIdUuid)
          .eq("status", "active");

        if (fetchError) {
          console.error(
            "qr_counteroffers fetch error",
            offerIdUuid,
            fetchError,
          );
          continue;
        }

        const { error: offerUpdateError } = await supabase
          .from("qr_offers")
          .update({ status: "canceled" })
          .eq("id", offerIdUuid);

        if (offerUpdateError)
          console.error(
            "qr_offers update error",
            offerIdUuid,
            offerUpdateError,
          );
        else console.log("offer marked canceled", offerIdUuid);

        if (!counterOffers || counterOffers.length === 0) {
          console.log("no active counter offers for offer", offerIdUuid);
          continue;
        }

        const { error: updateError } = await supabase
          .from("qr_counteroffers")
          .update({ status: "seller_canceled" })
          .in(
            "ephemeral_id",
            counterOffers.map((co) => co.ephemeral_id),
          );

        if (updateError)
          console.error(
            "qr_counteroffers update error",
            offerIdUuid,
            updateError,
          );
        else
          console.log(
            "counter offers marked seller_canceled",
            offerIdUuid,
            counterOffers.length,
          );

        // Drop any seller hidden-markers for these now-canceled counter offers.
        const { error: hiddenDelError } = await supabase
          .from("qr_counteroffers_seller_state")
          .delete()
          .in("counteroffer_id", counterOffers.map((co) => co.id));
        if (hiddenDelError)
          console.error("seller_state cleanup error", hiddenDelError);

        const connection = new Connection(Deno.env.get("SOLANA_RPC_URL")!, {
          commitment: "confirmed",
          fetch,
        });
        const keypairBytes = new Uint8Array(
          JSON.parse(Deno.env.get("SOL_BACKEND_KEYPAIR")!),
        );
        const backendKeypair = Keypair.fromSecretKey(keypairBytes);
        const programId = new PublicKey(Deno.env.get("PROGRAM_ID")!);

        const backendBalance = await connection.getBalance(
          backendKeypair.publicKey,
        );
        const numBatches = Math.ceil(counterOffers.length / BATCH_SIZE);
        const requiredLamports = numBatches * NETWORK_FEE_PER_TX;
        if (backendBalance < requiredLamports) {
          console.error(
            "backend wallet underfunded — admin refunds will fail",
            backendKeypair.publicKey.toBase58(),
            "balance",
            backendBalance,
            "needed(approx)",
            requiredLamports,
          );
        }

        // toSeller: false — escrow back to each buyer. The sender pre-filters
        // records against the chain (a buyer who already self-canceled would
        // otherwise fail the whole atomic batch) and retries survivors.
        const { signatures, dropped, errors } = await sendAdminSettles(
          connection,
          backendKeypair,
          programId,
          counterOffers.map((co) => ({
            ephemeralId: co.ephemeral_id,
            buyerWallet: co.buyer_wallet,
            sellerWallet,
            toSeller: false,
            feeAmount: 0,
          })),
        );

        if (signatures.length)
          console.log("admin refunds sent", offerIdUuid, signatures);
        if (dropped.length)
          console.warn(
            "records already consumed on chain, skipped",
            offerIdUuid,
            dropped.map((d) => d.ephemeralId),
          );
        if (errors.length)
          console.error("admin refund errors", offerIdUuid, errors);
      }
    }
  }

  return new Response("ok", { status: 200 });
});
