import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );

  const { data: { user }, error } = await supabase.auth.getUser(authHeader.slice(7));
  if (error || !user) return new Response("Unauthorized", { status: 401, headers: corsHeaders });

  const { wallet } = await req.json();
  if (!wallet) return new Response("Missing wallet", { status: 400, headers: corsHeaders });

  const keypairBytes = new Uint8Array(JSON.parse(Deno.env.get("BACKEND_KEYPAIR")!));
  const secretKey = keypairBytes;
  const publicKeyBytes = keypairBytes.slice(32);

  const walletBytes = new PublicKey(wallet).toBytes();

  const uuidHex = user.id.replace(/-/g, "");
  const uuidBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    uuidBytes[i] = parseInt(uuidHex.slice(i * 2, i * 2 + 2), 16);
  }

  const expiry = BigInt(Math.floor(Date.now() / 1000) + 60);
  const expiryBytes = new Uint8Array(8);
  new DataView(expiryBytes.buffer).setBigInt64(0, expiry, true);

  const message = new Uint8Array(56);
  message.set(walletBytes, 0);
  message.set(uuidBytes, 32);
  message.set(expiryBytes, 48);

  const signature = nacl.sign.detached(message, secretKey);

  return Response.json({
    signature: btoa(String.fromCharCode(...signature)),
    expiry: Number(expiry),
    backendPublicKey: new PublicKey(publicKeyBytes).toBase58(),
  }, { headers: corsHeaders });
});
