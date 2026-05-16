import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

      // OfferAccepted: 8 disc + 16 uuid + 32 seller + 8 total_amount + 8 timestamp = 72 bytes
      if (bytes.length < 72 || !arraysEqual(bytes.slice(0, 8), disc)) continue;

      const ephemeralId = bytesToUuid(bytes.slice(8, 24));

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

      // Get offer id and increment bought quantity
      const { data: counteroffers_data, error: offerIdError } = await supabase
        .from("qr_counteroffers")
        .select("offer_id")
        .eq("id", counterOfferIds[0])
        .single();

      if (offerIdError) {
        console.error("qr_counteroffers get offer id error", offerIdError);
        continue;
      }

      const { error: qtyError } = await supabase.rpc(
        "increment_offer_quantity_sold_by",
        {
          p_offer_id: counteroffers_data.offer_id,
          p_amount: counterOfferIds.length,
        },
      );
      if (qtyError) console.error("quantity increment error", qtyError);

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
