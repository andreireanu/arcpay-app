import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

async function offerAdminRefundedDiscriminator(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("event:OfferAdminRefunded"),
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

  const disc = await offerAdminRefundedDiscriminator();

  for (const tx of transactions) {
    const logs: string[] = tx.meta?.logMessages ?? tx.logs ?? [];

    for (const log of logs) {
      if (!log.startsWith("Program data: ")) continue;

      const bytes = Uint8Array.from(
        atob(log.slice("Program data: ".length)),
        (c) => c.charCodeAt(0),
      );

      // OfferAdminRefunded: 8 disc + 16 uuid + 32 buyer + 32 seller + 8 amount + 8 timestamp = 104 bytes
      if (bytes.length < 104 || !arraysEqual(bytes.slice(0, 8), disc)) continue;

      const ephemeralUuid = bytesToUuid(bytes.slice(8, 24));

      const { error } = await supabase
        .from("qr_counteroffers")
        .update({ rent_returned: true })
        .eq("ephemeral_id", ephemeralUuid);

      if (error) console.error("rent_returned update error", ephemeralUuid, error);
      else console.log("rent_returned set for ephemeral", ephemeralUuid);
    }
  }

  return new Response("ok", { status: 200 });
});
