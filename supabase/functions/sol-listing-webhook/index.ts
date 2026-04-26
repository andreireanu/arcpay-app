import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1";
import QRCode from "https://esm.sh/qrcode@1.5.4";

async function discriminator(name: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`event:${name}`),
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

  const siteUrl = Deno.env.get("SITE_URL")!;

  const [discCreated, discPaused, discResumed] = await Promise.all([
    discriminator("ListingCreated"),
    discriminator("ListingPaused"),
    discriminator("ListingResumed"),
  ]);

  for (const tx of transactions) {
    const logs: string[] = tx.meta?.logMessages ?? tx.logs ?? [];

    for (const log of logs) {
      if (!log.startsWith("Program data: ")) continue;

      const bytes = Uint8Array.from(
        atob(log.slice("Program data: ".length)),
        (c) => c.charCodeAt(0),
      );

      if (bytes.length < 8) continue;
      const disc = bytes.slice(0, 8);

      // ListingCreated: 8 disc + 32 listing + 32 seller + 8 price + 16 uuid + 8 timestamp = 104 bytes
      if (bytes.length >= 104 && arraysEqual(disc, discCreated)) {
        const listingPda = new PublicKey(bytes.slice(8, 40)).toBase58();
        const offerId = bytesToUuid(bytes.slice(80, 96));

        const payUrl = `${siteUrl}/pay/${offerId}`;
        const svg: string = await QRCode.toString(payUrl, { type: "svg" });

        const { error: uploadError } = await supabase.storage
          .from("qr-codes")
          .upload(`${offerId}.svg`, new TextEncoder().encode(svg), {
            contentType: "image/svg+xml",
            upsert: true,
          });
        if (uploadError) { console.error("upload error", uploadError); continue; }

        const { data: { publicUrl } } = supabase.storage
          .from("qr-codes")
          .getPublicUrl(`${offerId}.svg`);

        const { error: listingError } = await supabase
          .from("qr_listings")
          .insert({ offer_id: offerId, listing_pda: listingPda, qr_url: publicUrl });
        if (listingError) { console.error("listing insert error", listingError); continue; }

        const { error: statusError } = await supabase
          .from("qr_offers_data")
          .update({ status: "active" })
          .eq("id", offerId);
        if (statusError) console.error("status update error", statusError);
        continue;
      }

      // ListingPaused / ListingResumed: 8 disc + 32 listing + 32 seller + 8 timestamp = 80 bytes
      if (bytes.length >= 80 && (arraysEqual(disc, discPaused) || arraysEqual(disc, discResumed))) {
        const listingPda = new PublicKey(bytes.slice(8, 40)).toBase58();
        const newStatus = arraysEqual(disc, discPaused) ? "paused" : "active";

        const { data: listing } = await supabase
          .from("qr_listings")
          .select("offer_id")
          .eq("listing_pda", listingPda)
          .single();
        if (!listing) { console.error("listing not found", listingPda); continue; }

        const { error } = await supabase
          .from("qr_offers_data")
          .update({ status: newStatus })
          .eq("id", listing.offer_id);
        if (error) console.error("status update error", error);
        continue;
      }
    }
  }

  return new Response("ok", { status: 200 });
});
