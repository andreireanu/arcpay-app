import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1";

async function walletRegisteredDiscriminator(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("event:WalletRegistered"),
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

  const disc = await walletRegisteredDiscriminator();

  for (const tx of transactions) {
    const logs: string[] = tx.meta?.logMessages ?? tx.logs ?? [];

    for (const log of logs) {
      if (!log.startsWith("Program data: ")) continue;

      const bytes = Uint8Array.from(
        atob(log.slice("Program data: ".length)),
        (c) => c.charCodeAt(0),
      );

      // WalletRegistered: 8 discriminator + 32 user_profile + 32 wallet + 8 timestamp = 80 bytes
      if (bytes.length < 80 || !arraysEqual(bytes.slice(0, 8), disc)) continue;

      const userProfile = new PublicKey(bytes.slice(8, 40)).toBase58();
      const wallet = new PublicKey(bytes.slice(40, 72)).toBase58();

      const { error } = await supabase
        .from("qr_generator_sellers")
        .upsert(
          { id: userProfile, wallet_address: wallet },
          { onConflict: "id" },
        );

      if (error) console.error("upsert error", error);
    }
  }

  return new Response("ok", { status: 200 });
});
