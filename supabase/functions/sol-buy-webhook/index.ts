import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1";

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

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const disc = await buyCompletedDiscriminator();

  for (const tx of transactions) {
    const logs: string[] = tx.meta?.logMessages ?? tx.logs ?? [];
    const txSignature: string = tx.signature ?? tx.transaction?.signatures?.[0] ?? "";

    for (const log of logs) {
      if (!log.startsWith("Program data: ")) continue;

      const bytes = Uint8Array.from(
        atob(log.slice("Program data: ".length)),
        (c) => c.charCodeAt(0),
      );

      // BuyCompleted: 8 disc + 16 offer_id + 32 buyer + 32 seller + 8 seller_amount + 8 fee_amount + 8 timestamp = 112 bytes
      if (bytes.length < 112 || !arraysEqual(bytes.slice(0, 8), disc)) continue;

      const offerId = bytesToUuid(bytes.slice(8, 24));
      const buyerWallet = new PublicKey(bytes.slice(24, 56)).toBase58();
      const sellerWallet = new PublicKey(bytes.slice(56, 88)).toBase58();
      const sellerAmount = Number(new DataView(bytes.buffer, bytes.byteOffset + 88, 8).getBigUint64(0, true));
      const feeAmount = Number(new DataView(bytes.buffer, bytes.byteOffset + 96, 8).getBigUint64(0, true));

      const { error: txError } = await supabase
        .from("qr_transactions")
        .insert({
          offer_id: offerId,
          buyer_wallet: buyerWallet,
          seller_wallet: sellerWallet,
          tx_signature: txSignature,
          seller_amount: sellerAmount,
          fee_amount: feeAmount,
        });
      if (txError) console.error("transaction insert error", txError);

      const { error: statusError } = await supabase
        .from("qr_offers")
        .update({ status: "sold" })
        .eq("id", offerId);
      if (statusError) console.error("status update error", statusError);
    }
  }

  return new Response("ok", { status: 200 });
});
