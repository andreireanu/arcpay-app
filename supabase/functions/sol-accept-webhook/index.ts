import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Connection, Keypair, PublicKey } from "npm:@solana/web3.js@1";
import {
  BATCH_SIZE,
  NETWORK_FEE_PER_TX,
  sendAdminSettles,
} from "../_sol-shared/sendAdminSettles.ts";

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

// Settlement driver. The accept tx moved no funds — it is the seller's on-chain
// consent for the witness uuid. This webhook turns that consent into one
// admin_settle_offer per counter offer (batched, pre-filtered against the
// chain). Counter offers are NOT marked confirmed here: that happens in the
// settle webhook off each OfferBought event, so a crash mid-settlement loses
// nothing — redelivery re-runs the driver and the chain filter skips whatever
// already settled.
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

      // OfferAccepted: 8 disc + 16 uuid + 32 seller + 8 timestamp = 64 bytes
      if (bytes.length < 64 || !arraysEqual(bytes.slice(0, 8), disc)) continue;

      const ephemeralId = bytesToUuid(bytes.slice(8, 24));
      const sellerWallet = base58Encode(bytes.slice(24, 56));
      console.log("offer_accepted event", ephemeralId, "seller", sellerWallet);

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

      if (witness.status === "completed") {
        console.warn("witness already completed, skipping", ephemeralId);
        continue;
      }

      const counterOfferIds: string[] = witness.offers;

      const { data: counteroffers_data, error: coError } = await supabase
        .from("qr_counteroffers")
        .select("id, ephemeral_id, buyer_wallet, fee_amount, qr_offers(seller_wallet)")
        .in("id", counterOfferIds);

      if (coError || !counteroffers_data || counteroffers_data.length === 0) {
        console.error("qr_counteroffers fetch error", ephemeralId, coError);
        continue;
      }

      // The accept event's seller must own every counter offer in the witness —
      // anything else means the witness and the on-chain consent disagree.
      const mismatched = counteroffers_data.filter(
        (co) =>
          (co.qr_offers as { seller_wallet: string } | null)?.seller_wallet !==
          sellerWallet,
      );
      if (mismatched.length > 0) {
        console.error(
          "seller mismatch — refusing to settle",
          ephemeralId,
          mismatched.map((co) => co.id),
        );
        continue;
      }

      const connection = new Connection(Deno.env.get("SOLANA_RPC_URL")!, {
        commitment: "confirmed",
        fetch,
      });
      const backendKeypair = Keypair.fromSecretKey(
        new Uint8Array(JSON.parse(Deno.env.get("SOL_BACKEND_KEYPAIR")!)),
      );
      const programId = new PublicKey(Deno.env.get("PROGRAM_ID")!);

      const backendBalance = await connection.getBalance(
        backendKeypair.publicKey,
      );
      const numBatches = Math.ceil(counteroffers_data.length / BATCH_SIZE);
      const requiredLamports = numBatches * NETWORK_FEE_PER_TX;
      if (backendBalance < requiredLamports) {
        console.error(
          "backend wallet underfunded — settlement will fail",
          backendKeypair.publicKey.toBase58(),
          "balance",
          backendBalance,
          "needed(approx)",
          requiredLamports,
        );
      }

      const { signatures, dropped, errors } = await sendAdminSettles(
        connection,
        backendKeypair,
        programId,
        counteroffers_data.map((co) => ({
          ephemeralId: co.ephemeral_id,
          buyerWallet: co.buyer_wallet,
          sellerWallet,
          toSeller: true,
          feeAmount: co.fee_amount,
        })),
      );

      if (signatures.length)
        console.log("settlements sent", ephemeralId, signatures);
      if (dropped.length)
        // already consumed on chain: settled by an earlier (re)delivery, or the
        // buyer canceled before settlement — the matching webhook records it
        console.warn(
          "records no longer on chain, skipped",
          ephemeralId,
          dropped.map((d) => d.ephemeralId),
        );
      if (errors.length) {
        // leave the witness pending: a webhook redelivery re-runs the driver
        // and the chain filter makes that convergent
        console.error("settlement errors", ephemeralId, errors);
        continue;
      }

      const { error: witnessUpdateError } = await supabase
        .from("qr_accepted_counter")
        .update({ status: "completed" })
        .eq("id", ephemeralId);

      if (witnessUpdateError)
        console.error("qr_accepted_counter update error", witnessUpdateError);

      console.log(
        "settlement dispatched for accepted_counter",
        ephemeralId,
        "counter_offers",
        counterOfferIds,
      );
    }
  }

  return new Response("ok", { status: 200 });
});
