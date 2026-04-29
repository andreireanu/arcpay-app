import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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
    .select("price_lamports, fee_bps, seller_wallet, status")
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

  const keypairBytes = new Uint8Array(JSON.parse(Deno.env.get("BACKEND_KEYPAIR")!));
  const secretKey = keypairBytes;
  const publicKeyBytes = keypairBytes.slice(32);

  const buyerBytes = new PublicKey(buyer_wallet).toBytes();
  const sellerBytes = new PublicKey(offer.seller_wallet).toBytes();
  const offerIdBytes = uuidToBytes(offer_id);
  const sellerAmount = BigInt(offer.price_lamports);
  const feeAmount = BigInt(Math.floor(offer.price_lamports * (offer.fee_bps ?? 0) / 10000));
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 120); // 2 minute window

  const sellerAmountBytes = new Uint8Array(8);
  const feeAmountBytes = new Uint8Array(8);
  const expiryBytes = new Uint8Array(8);
  new DataView(sellerAmountBytes.buffer).setBigUint64(0, sellerAmount, true);
  new DataView(feeAmountBytes.buffer).setBigUint64(0, feeAmount, true);
  new DataView(expiryBytes.buffer).setBigInt64(0, expiry, true);

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
    backendPublicKey: new PublicKey(publicKeyBytes).toBase58(),
    sellerAmount: Number(sellerAmount),
    feeAmount: Number(feeAmount),
    sellerWallet: offer.seller_wallet,
  }, { headers: corsHeaders });
});
