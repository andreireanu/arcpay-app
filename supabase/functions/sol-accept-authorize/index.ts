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

  const { counter_offer_ids, seller_wallet } = await req.json();

  if (!Array.isArray(counter_offer_ids) || counter_offer_ids.length === 0) {
    return new Response("counter_offer_ids must be a non-empty array", { status: 400, headers: CORS });
  }
  if (!seller_wallet) {
    return new Response("Missing seller_wallet", { status: 400, headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Fetch all counter offers and join with their parent offer to verify seller
  // ownership. The seller/fee split was already computed and stored when the
  // counter offer was registered, so we just read it back here.
  const { data: counterOffers, error: fetchError } = await supabase
    .from("qr_counteroffers")
    .select("id, seller_amount, fee_amount, status, expiry_at, offer_id, qr_offers(seller_wallet)")
    .in("id", counter_offer_ids);

  if (fetchError || !counterOffers) {
    console.error("fetch error", fetchError);
    return new Response("Internal error", { status: 500, headers: CORS });
  }

  if (counterOffers.length !== counter_offer_ids.length) {
    return new Response("One or more counter offers not found", { status: 404, headers: CORS });
  }

  // Sum the stored seller/fee split across all accepted offers. Mirrors the buy
  // flow's seller_amount / fee_amount split.
  let sellerAmount = 0;
  let feeAmount = 0;
  for (const co of counterOffers) {
    const offer = co.qr_offers as { seller_wallet: string } | null;
    if (offer?.seller_wallet !== seller_wallet) {
      return new Response("Unauthorized: counter offer does not belong to this seller", { status: 403, headers: CORS });
    }
    if (co.status !== "active") {
      return new Response(`Counter offer ${co.id} is not active`, { status: 400, headers: CORS });
    }
    if (new Date(co.expiry_at) <= new Date()) {
      return new Response(`Counter offer ${co.id} has expired`, { status: 400, headers: CORS });
    }
    sellerAmount += co.seller_amount;
    feeAmount += co.fee_amount;
  }

  // Insert witness row — id is the ephemeral UUID passed to the program
  const { data: witness, error: insertError } = await supabase
    .from("qr_accepted_counter")
    .insert({ offers: counter_offer_ids, status: "pending" })
    .select("id")
    .single();

  if (insertError || !witness) {
    console.error("insert error", insertError);
    return new Response("Internal error", { status: 500, headers: CORS });
  }

  const ephemeralUuid = witness.id as string;

  const keypairBytes = new Uint8Array(JSON.parse(Deno.env.get("BACKEND_KEYPAIR")!));
  const publicKeyBytes = keypairBytes.slice(32);

  const expiry = BigInt(Math.floor(Date.now() / 1000) + 300); // 5-minute window

  // Message layout (72 bytes):
  //   [0..32]  seller pubkey
  //   [32..48] ephemeral uuid (16 bytes)
  //   [48..56] seller_amount (u64 LE)
  //   [56..64] fee_amount (u64 LE)
  //   [64..72] expiry (i64 LE)
  const sellerAmountBytes = new Uint8Array(8);
  const feeAmountBytes = new Uint8Array(8);
  const expiryBytes = new Uint8Array(8);
  new DataView(sellerAmountBytes.buffer).setBigUint64(0, BigInt(sellerAmount), true);
  new DataView(feeAmountBytes.buffer).setBigUint64(0, BigInt(feeAmount), true);
  new DataView(expiryBytes.buffer).setBigInt64(0, expiry, true);

  const message = new Uint8Array(72);
  message.set(pubkeyToBytes(seller_wallet), 0);
  message.set(uuidToBytes(ephemeralUuid), 32);
  message.set(sellerAmountBytes, 48);
  message.set(feeAmountBytes, 56);
  message.set(expiryBytes, 64);

  const signature = nacl.sign.detached(message, keypairBytes);

  return Response.json({
    ephemeralUuid,
    signature: btoa(String.fromCharCode(...signature)),
    expiry: Number(expiry),
    backendPublicKey: base58Encode(publicKeyBytes),
    sellerAmount,
    feeAmount,
  }, { headers: CORS });
});
