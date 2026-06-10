import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function buyCompletedDiscriminator(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("event:BuyCompleted"),
  );
  return new Uint8Array(hash, 0, 8);
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("HELIUS_WEBHOOK_SECRET");
  if (secret && req.headers.get("authorization") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const payload = await req.json();
  const transactions = Array.isArray(payload) ? payload : [payload];
  console.log("sol-buy-webhook received", transactions.length, "tx(s)");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const disc = await buyCompletedDiscriminator();

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

      // BuyCompleted: 8 disc + 16 offer_id + 32 buyer + 32 seller + 8 seller_amount + 8 fee_amount + 8 timestamp = 112 bytes
      if (bytes.length < 112 || !arraysEqual(bytes.slice(0, 8), disc)) continue;

      const offerId = bytesToUuid(bytes.slice(8, 24));
      const buyerWallet = base58Encode(bytes.slice(24, 56));
      // bytes 56–88 are the seller wallet (skipped — derivable from qr_offers)
      const sellerAmount = Number(
        new DataView(bytes.buffer, bytes.byteOffset + 88, 8).getBigUint64(
          0,
          true,
        ),
      );
      const feeAmount = Number(
        new DataView(bytes.buffer, bytes.byteOffset + 96, 8).getBigUint64(
          0,
          true,
        ),
      );

      console.log("buy_completed event", offerId, "buyer", buyerWallet);

      const { error: txError } = await supabase.from("qr_transactions").insert({
        offer_id: offerId,
        buyer_wallet: buyerWallet,
        tx_signature: txSignature,
        seller_amount: sellerAmount,
        fee_amount: feeAmount,
        quantity: 1,
      });
      if (txError) {
        // code 23505 = unique_violation: Helius delivered this webhook twice, safe to ignore.
        if (txError.code === "23505")
          console.warn("duplicate webhook delivery, skipping", txSignature);
        else console.error("transaction insert error", txError);
        continue;
      }

      const { error: qtyError } = await supabase.rpc(
        "increment_offer_quantity_sold_by",
        { p_offer_id: offerId, p_amount: 1 },
      );
      if (qtyError) console.error("quantity increment error", qtyError);
      else console.log("buy recorded", offerId, txSignature);

      // Mark the buyer confirmed (row was inserted with confirmed=false when the
      // buy was initiated on the frontend). Pure wallet-keyed flip — no user_id.
      const { error: buyerError } = await supabase
        .from("buyers")
        .update({ confirmed: true })
        .eq("wallet_address", buyerWallet);
      if (buyerError) console.error("buyer confirm error", buyerError);
    }
  }

  return new Response("ok", { status: 200 });
});
