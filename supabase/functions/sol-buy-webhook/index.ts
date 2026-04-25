import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1";

async function listingAcceptedDiscriminator(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("event:ListingAccepted"),
  );
  return new Uint8Array(hash, 0, 8);
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
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

  const disc = await listingAcceptedDiscriminator();

  for (const tx of transactions) {
    const logs: string[] = tx.meta?.logMessages ?? tx.logs ?? [];
    const txSignature: string = tx.signature ?? tx.transaction?.signatures?.[0] ?? "";

    for (const log of logs) {
      if (!log.startsWith("Program data: ")) continue;

      const bytes = Uint8Array.from(
        atob(log.slice("Program data: ".length)),
        (c) => c.charCodeAt(0),
      );

      // ListingAccepted: 8 disc + 32 listing + 32 buyer + 32 seller + 8 amount + 8 timestamp = 120 bytes
      if (bytes.length < 120 || !arraysEqual(bytes.slice(0, 8), disc)) continue;

      const listingPda = new PublicKey(bytes.slice(8, 40)).toBase58();
      const buyerWallet = new PublicKey(bytes.slice(40, 72)).toBase58();
      const priceLamports = Number(
        new DataView(bytes.buffer, bytes.byteOffset + 104, 8).getBigUint64(0, true),
      );

      const { error: txError } = await supabase
        .from("qr_transactions")
        .insert({
          listing_pda: listingPda,
          buyer_wallet: buyerWallet,
          tx_signature: txSignature,
          price_lamports: priceLamports,
        });
      if (txError) {
        console.error("transaction insert error", txError);
        continue;
      }

      const { data: listing, error: listingError } = await supabase
        .from("qr_listings")
        .select("offer_id")
        .eq("listing_pda", listingPda)
        .single();
      if (listingError || !listing) {
        console.error("listing lookup error", listingError);
        continue;
      }

      const { error: statusError } = await supabase
        .from("qr_offers_data")
        .update({ status: "sold" })
        .eq("id", listing.offer_id);
      if (statusError) console.error("status update error", statusError);
    }
  }

  return new Response("ok", { status: 200 });
});
