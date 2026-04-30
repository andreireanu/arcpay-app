import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";
import { PublicKey } from "https://esm.sh/@solana/web3.js@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, x-client-info, apikey",
};

function buildMessage(wallet: string): Uint8Array {
  const text = [
    "Welcome to ArcPay!",
    "",
    "Click to sign in and confirm ownership of this wallet.",
    "",
    "This request will not trigger a blockchain transaction or cost any gas fees.",
    "",
    "Domain: app.arcpay.to",
    `Wallet address: ${wallet}`,
  ].join("\n");
  return new TextEncoder().encode(text);
}

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

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(authHeader.slice(7));
  if (authError || !user) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  const { wallet, signature: signatureArray } = await req.json();
  if (!wallet || !Array.isArray(signatureArray)) {
    return new Response("Missing wallet or signature", {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Verify the wallet signature
  let walletPubkeyBytes: Uint8Array;
  try {
    walletPubkeyBytes = new PublicKey(wallet).toBytes();
  } catch {
    return new Response("Invalid wallet address", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const msgBytes = buildMessage(wallet);
  const signatureBytes = new Uint8Array(signatureArray);

  const valid = nacl.sign.detached.verify(
    msgBytes,
    signatureBytes,
    walletPubkeyBytes,
  );
  if (!valid) {
    return new Response("Invalid signature", {
      status: 400,
      headers: corsHeaders,
    });
  }

  // Check if wallet is already claimed by a different account
  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: existing } = await serviceClient
    .from("sellers")
    .select("user_id")
    .eq("wallet_address", wallet)
    .maybeSingle();

  if (existing && existing.user_id !== user.id) {
    return new Response("Wallet already registered to another account", {
      status: 409,
      headers: corsHeaders,
    });
  }

  const { error: upsertError } = await serviceClient
    .from("sellers")
    .upsert(
      { wallet_address: wallet, user_id: user.id },
      { onConflict: "wallet_address" },
    );

  if (upsertError) {
    console.error("upsert error", upsertError);
    return new Response("Database error", {
      status: 500,
      headers: corsHeaders,
    });
  }

  return new Response("ok", { status: 200, headers: corsHeaders });
});
