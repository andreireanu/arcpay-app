import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(BASE58.indexOf(c));
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  const leadingZeros = s.match(/^1*/)?.[0].length ?? 0;
  return new Uint8Array([...Array(leadingZeros).fill(0), ...bytes]);
}

function base58Encode(bytes: Uint8Array): string {
  let n = bytes.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  const chars: string[] = [];
  while (n > 0n) { chars.unshift(BASE58[Number(n % 58n)]); n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; chars.unshift("1"); }
  return chars.join("");
}

// Always returns exactly 32 bytes (Solana pubkey).
function pubkeyToBytes(address: string): Uint8Array {
  const decoded = base58Decode(address);
  const out = new Uint8Array(32);
  out.set(decoded, 32 - decoded.length);
  return out;
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const { offer_id, buyer_wallet, amount_lamports } = await req.json();
  if (!offer_id || !buyer_wallet || !amount_lamports) {
    return new Response("Missing fields", { status: 400, headers: CORS });
  }
  if (amount_lamports <= 0) {
    return new Response("amount_lamports must be positive", { status: 400, headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: offer, error } = await supabase
    .from("qr_offers")
    .select("status, seller_wallet")
    .eq("id", offer_id)
    .maybeSingle();

  if (error || !offer) return new Response("Offer not found", { status: 404, headers: CORS });
  if (offer.status !== "active") return new Response("Offer is not active", { status: 400, headers: CORS });
  if (!offer.seller_wallet) return new Response("Offer has no seller wallet", { status: 400, headers: CORS });

  const ephemeralUuid = crypto.randomUUID();

  const { error: insertError } = await supabase
    .from("qr_ephemeral")
    .insert({ id: ephemeralUuid, offer_id, status: "pending" });
  if (insertError) {
    console.error("qr_ephemeral insert error", insertError);
    return new Response("Internal error", { status: 500, headers: CORS });
  }

  const keypairBytes = new Uint8Array(JSON.parse(Deno.env.get("SOL_BACKEND_KEYPAIR")!));
  const publicKeyBytes = keypairBytes.slice(32);

  const expiry = BigInt(Math.floor(Date.now() / 1000) + 300); // 5-minute window

  // Message layout (96 bytes) matching auth_offer.rs:
  //   [0..32]  buyer pubkey
  //   [32..64] seller pubkey — binds the escrow's payout target; without it a
  //            malicious client could create a record whose seller differs from
  //            the listing's, and settlement pays record.seller
  //   [64..80] ephemeral uuid (16 bytes)
  //   [80..88] amount (u64 LE)
  //   [88..96] expiry (i64 LE)
  const amountBytes = new Uint8Array(8);
  const expiryBytes = new Uint8Array(8);
  new DataView(amountBytes.buffer).setBigUint64(0, BigInt(amount_lamports), true);
  new DataView(expiryBytes.buffer).setBigInt64(0, expiry, true);

  const message = new Uint8Array(96);
  message.set(pubkeyToBytes(buyer_wallet), 0);
  message.set(pubkeyToBytes(offer.seller_wallet), 32);
  message.set(uuidToBytes(ephemeralUuid), 64);
  message.set(amountBytes, 80);
  message.set(expiryBytes, 88);

  const signature = nacl.sign.detached(message, keypairBytes);

  return Response.json({
    ephemeralUuid,
    signature: btoa(String.fromCharCode(...signature)),
    expiry: Number(expiry),
    backendPublicKey: base58Encode(publicKeyBytes),
    sellerWallet: offer.seller_wallet,
  }, { headers: CORS });
});
