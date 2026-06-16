import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import { PublicKey } from "npm:@solana/web3.js@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// A Sui address is a 32-byte value written as 0x + 64 hex (leading zeros may be
// trimmed). `sui::address::to_bytes` yields those 32 bytes big-endian, which is
// what the contract hashes into the auth message.
function suiAddressBytes(addr: string): Uint8Array {
  const hex = addr.replace(/^0x/, "").padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Sui ed25519 seed (hexWithoutFlag — the raw 32-byte private key) → keypair.
function suiKeypairFromHex(hex: string): {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
} {
  const clean = hex.trim().replace(/^0x/, "");
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    seed[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return { secretKey: pair.secretKey, publicKey: pair.publicKey };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
  const { offer_id, buyer_wallet } = await req.json();
  if (!offer_id || !buyer_wallet) {
    return new Response("Missing offer_id or buyer_wallet", { status: 400, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: offer, error } = await supabase
    .from("qr_offers")
    .select("price_lamports, fee_bps, seller_wallet, status, unlimited, quantity, quantity_sold, chain")
    .eq("id", offer_id)
    .maybeSingle();

  if (error || !offer) {
    return new Response("Offer not found", { status: 404, headers: corsHeaders });
  }
  if (offer.status !== "active") {
    return new Response("Offer is not active", { status: 400, headers: corsHeaders });
  }
  if (!offer.seller_wallet) {
    return new Response("Offer has no seller wallet", { status: 400, headers: corsHeaders });
  }
  if (!offer.unlimited && offer.quantity_sold >= offer.quantity) {
    return new Response("Offer is sold out", { status: 400, headers: corsHeaders });
  }

  // The signed-message LAYOUT is identical across chains (buyer(32) || seller(32)
  // || offer_id(16) || seller_amount(8) || fee_amount(8) || expiry(8)). Only three
  // things differ by chain: the backend signing key, how a wallet address encodes
  // to 32 bytes (Solana base58 pubkey vs Sui 0x-hex address), and the expiry unit
  // (Solana's clock is unix SECONDS, Sui's Clock is MILLISECONDS).
  const isSui = offer.chain === "sui";

  let secretKey: Uint8Array;
  let publicKeyBytes: Uint8Array;
  let buyerBytes: Uint8Array;
  let sellerBytes: Uint8Array;
  let expiry: bigint;
  let backendPublicKey: string;

  if (isSui) {
    // SUI_BACKEND_KEYPAIR: the backend's ed25519 private key as hex
    // (Sui's hexWithoutFlag). Its public half must equal the Config's
    // backend_pubkey on-chain.
    const parsed = suiKeypairFromHex(Deno.env.get("SUI_BACKEND_KEYPAIR")!);
    secretKey = parsed.secretKey;
    publicKeyBytes = parsed.publicKey;
    buyerBytes = suiAddressBytes(buyer_wallet);
    sellerBytes = suiAddressBytes(offer.seller_wallet);
    expiry = BigInt(Date.now() + 120_000); // ms — Sui Clock is millisecond-based
    backendPublicKey =
      "0x" + [...publicKeyBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    const kp = new Uint8Array(JSON.parse(Deno.env.get("SOL_BACKEND_KEYPAIR")!));
    secretKey = kp;
    publicKeyBytes = kp.slice(32);
    buyerBytes = new PublicKey(buyer_wallet).toBytes();
    sellerBytes = new PublicKey(offer.seller_wallet).toBytes();
    expiry = BigInt(Math.floor(Date.now() / 1000) + 120); // seconds — Solana clock
    backendPublicKey = new PublicKey(publicKeyBytes).toBase58();
  }

  const offerIdBytes = uuidToBytes(offer_id);
  const feeAmount = BigInt(Math.floor(offer.price_lamports * (offer.fee_bps ?? 0) / 10000));
  const sellerAmount = BigInt(offer.price_lamports) - feeAmount;

  const sellerAmountBytes = new Uint8Array(8);
  const feeAmountBytes = new Uint8Array(8);
  const expiryBytes = new Uint8Array(8);
  new DataView(sellerAmountBytes.buffer).setBigUint64(0, sellerAmount, true);
  new DataView(feeAmountBytes.buffer).setBigUint64(0, feeAmount, true);
  // Unsigned LE u64 — matches both Solana's i64 (positive) and Sui's bcs u64.
  new DataView(expiryBytes.buffer).setBigUint64(0, expiry, true);

  // Message layout: buyer(32) || seller(32) || offer_id(16) || seller_amount(8) || fee_amount(8) || expiry(8)
  const message = new Uint8Array(104);
  message.set(buyerBytes, 0);
  message.set(sellerBytes, 32);
  message.set(offerIdBytes, 64);
  message.set(sellerAmountBytes, 80);
  message.set(feeAmountBytes, 88);
  message.set(expiryBytes, 96);

  const signature = nacl.sign.detached(message, secretKey);

  return Response.json({
    signature: btoa(String.fromCharCode(...signature)),
    expiry: Number(expiry),
    backendPublicKey,
    sellerAmount: Number(sellerAmount),
    feeAmount: Number(feeAmount),
    sellerWallet: offer.seller_wallet,
  }, { headers: corsHeaders });
  } catch (err) {
    // Always return with CORS headers so the browser surfaces the real error
    // instead of a misleading "No Access-Control-Allow-Origin" CORS failure.
    console.error("buy-authorize failed", err);
    return new Response(
      `buy-authorize error: ${err instanceof Error ? err.message : String(err)}`,
      { status: 500, headers: corsHeaders },
    );
  }
});
