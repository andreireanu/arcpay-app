import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Connection, Keypair, PublicKey } from "npm:@solana/web3.js@1";
import { sendAdminSettles } from "../_sol-shared/sendAdminSettles.ts";
import {
  evaluateAutoAccept,
  markAutoAcceptTriggered,
} from "../_shared/autoAccept.ts";

async function offerCreatedDiscriminator(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("event:OfferCreated"),
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
  console.log("sol-counteroffer-webhook received", transactions.length, "tx(s)");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const disc = await offerCreatedDiscriminator();

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

      // OfferCreated: 8 disc + 16 uuid + 32 buyer + 8 amount + 8 timestamp = 72 bytes
      if (bytes.length < 72 || !arraysEqual(bytes.slice(0, 8), disc)) continue;

      const ephemeralUuid = bytesToUuid(bytes.slice(8, 24));
      const buyerWallet = base58Encode(bytes.slice(24, 56));
      const amount = Number(
        new DataView(bytes.buffer, bytes.byteOffset + 56, 8).getBigUint64(
          0,
          true,
        ),
      );

      console.log("offer_created event", ephemeralUuid, "buyer", buyerWallet, "amount", amount);

      // Look up the real offer_id from the ephemeral uuid mapping, and the
      // parent offer's fee_bps so we can persist the seller/fee split.
      const { data: ephemeral, error: lookupError } = await supabase
        .from("qr_ephemeral")
        .select("id, offer_id, qr_offers(fee_bps)")
        .eq("id", ephemeralUuid)
        .maybeSingle();

      if (lookupError || !ephemeral) {
        const { data: existing } = await supabase
          .from("qr_counteroffers")
          .select("id")
          .eq("tx_signature", txSignature)
          .maybeSingle();
        if (existing) {
          console.warn("duplicate webhook delivery, skipping", txSignature);
        } else {
          console.error("qr_ephemeral lookup failed", ephemeralUuid, lookupError);
        }
        continue;
      }

      // Carve the protocol fee out of the locked amount using the parent offer's
      // fee_bps, persisting the seller/fee split (the same split the seller will
      // later sign and the program will enforce on accept).
      const feeBps =
        (ephemeral.qr_offers as { fee_bps: number | null } | null)?.fee_bps ?? 0;
      const feeAmount = Math.floor((amount * feeBps) / 10000);
      const sellerAmount = amount - feeAmount;

      // Insert counter offer — skip if tx_signature already exists (duplicate delivery).
      const { error: insertError } = await supabase
        .from("qr_counteroffers")
        .insert({
          offer_id: ephemeral.offer_id,
          ephemeral_id: ephemeral.id,
          buyer_wallet: buyerWallet,
          tx_signature: txSignature,
          seller_amount: sellerAmount,
          fee_amount: feeAmount,
          // This is the Solana counter-offer webhook, so the counter offer is
          // always on Solana.
          chain: "solana",
        });

      if (insertError) {
        if (insertError.code === "23505")
          console.warn("duplicate webhook delivery, skipping", txSignature);
        else console.error("qr_counteroffers insert error", insertError);
        continue;
      }

      // Delete the ephemeral row now that it has been consumed.
      const { error: deleteError } = await supabase
        .from("qr_ephemeral")
        .delete()
        .eq("id", ephemeral.id);

      if (deleteError) console.error("qr_ephemeral delete error", deleteError);
      else console.log("deleted ephemeral", ephemeralUuid, "offer", ephemeral.offer_id);

      await runAutoAccept(supabase, ephemeral.offer_id);
    }
  }

  return new Response("ok", { status: 200 });
});

// Evaluate the seller's auto-accept rule for this offer and, if met, settle the
// best counter offers to the seller via admin_settle_offer (to_seller=true) —
// the same settle path the accept flow uses, just triggered by the stored rule
// instead of an on-chain consent event.
async function runAutoAccept(
  supabase: ReturnType<typeof createClient>,
  offerId: string,
): Promise<void> {
  const decision = await evaluateAutoAccept(supabase, offerId);
  if (!decision) return;

  const connection = new Connection(Deno.env.get("SOLANA_RPC_URL")!, {
    commitment: "confirmed",
    fetch,
  });
  const backendKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(Deno.env.get("SOL_BACKEND_KEYPAIR")!)),
  );
  const programId = new PublicKey(Deno.env.get("PROGRAM_ID")!);

  const { signatures, dropped, errors } = await sendAdminSettles(
    connection,
    backendKeypair,
    programId,
    decision.rows.map((co) => ({
      ephemeralId: co.ephemeral_id,
      buyerWallet: co.buyer_wallet,
      sellerWallet: decision.sellerWallet,
      toSeller: true,
      feeAmount: co.fee_amount,
    })),
  );

  if (signatures.length) console.log("auto-accept settled", offerId, signatures);
  if (dropped.length)
    console.warn(
      "auto-accept records already consumed, skipped",
      offerId,
      dropped.map((d) => d.ephemeralId),
    );
  if (errors.length) {
    // Leave the rule armed so the next counter offer re-runs the driver.
    console.error("auto-accept errors", offerId, errors);
    return;
  }

  await markAutoAcceptTriggered(supabase, offerId, decision.achievedAvg);
}
