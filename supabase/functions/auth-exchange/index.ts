import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "https://deno.land/x/jose@v4.15.5/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // 1. Extract Privy token from Authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Missing authorization header", { status: 401, headers: corsHeaders });
  }
  const privyToken = authHeader.slice(7);

  // 2. Extract wallet address from request body
  const { wallet_address: walletAddress } = await req.json();
  if (!walletAddress) {
    return new Response("Missing wallet_address", { status: 400, headers: corsHeaders });
  }

  const privyAppId = Deno.env.get("PRIVY_ID")!;

  // 3. Verify the Privy token via JWKS
  try {
    const JWKS = jose.createRemoteJWKSet(
      new URL(`https://auth.privy.io/api/v1/apps/${privyAppId}/jwks.json`),
    );
    await jose.jwtVerify(privyToken, JWKS, {
      issuer: "privy.io",
      audience: privyAppId,
    });
  } catch (err) {
    console.error("Privy token verification failed", err);
    return new Response("Invalid Privy token", { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 4. Find or create a Supabase auth user keyed by wallet address
  const internalEmail = `${walletAddress}@wallet.arcpay`;

  // sellers row holds the stable wallet→user_id mapping after first login
  const { data: sellerRow } = await supabase
    .from("sellers")
    .select("user_id")
    .eq("wallet_address", walletAddress)
    .single();

  let userId: string;
  if (sellerRow?.user_id) {
    userId = sellerRow.user_id;
  } else {
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email: internalEmail,
      email_confirm: true,
      user_metadata: { wallet_address: walletAddress },
    });
    if (createError || !newUser.user) {
      console.error("Failed to create Supabase user", createError);
      return new Response("Failed to create user", { status: 500, headers: corsHeaders });
    }
    userId = newUser.user.id;
  }

  // 5. Upsert sellers row
  await supabase.from("sellers").upsert(
    { wallet_address: walletAddress, user_id: userId },
    { onConflict: "wallet_address" },
  );

  // 6. Create a Supabase session for this user
  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: internalEmail,
  });
  if (linkError || !linkData) {
    console.error("Failed to generate session link", linkError);
    return new Response("Failed to create session", { status: 500, headers: corsHeaders });
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  if (sessionError || !sessionData.session) {
    console.error("Failed to exchange token for session", sessionError);
    return new Response("Failed to create session", { status: 500, headers: corsHeaders });
  }

  return Response.json({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  }, { headers: corsHeaders });
});
