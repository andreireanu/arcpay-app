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

  // 1. Extract Dynamic token from Authorization header
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Missing authorization header", { status: 401, headers: corsHeaders });
  }
  const dynamicToken = authHeader.slice(7);

  // 2. Extract wallet address from request body
  const { wallet_address: walletAddress } = await req.json();
  if (!walletAddress) {
    return new Response("Missing wallet_address", { status: 400, headers: corsHeaders });
  }

  const dynamicEnvId = Deno.env.get("DYNAMIC_ENV_ID")!;

  // 3. Verify the Dynamic token via JWKS
  try {
    const JWKS = jose.createRemoteJWKSet(
      new URL(`https://app.dynamic.xyz/api/v0/sdk/${dynamicEnvId}/.well-known/jwks`),
    );
    await jose.jwtVerify(dynamicToken, JWKS, {
      issuer: "app.dynamic.xyz",
    });
  } catch (err) {
    console.error("Dynamic token verification failed", err);
    return new Response("Invalid Dynamic token", { status: 401, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 4. Find or create a Supabase auth user keyed by wallet address
  const internalEmail = `${walletAddress}@wallet.arcpay`;

  // Try generateLink first — works if user already exists
  let { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: internalEmail,
  });

  if (linkError) {
    // User doesn't exist yet — create them
    const { error: createError } = await supabase.auth.admin.createUser({
      email: internalEmail,
      email_confirm: true,
      user_metadata: { wallet_address: walletAddress },
    });
    if (createError) {
      console.error("Failed to create Supabase user", createError);
      return new Response("Failed to create user", { status: 500, headers: corsHeaders });
    }

    ({ data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: internalEmail,
    }));
  }

  if (linkError || !linkData) {
    console.error("Failed to generate session link", linkError);
    return new Response("Failed to create session", { status: 500, headers: corsHeaders });
  }

  // 5. Exchange the magic link token for a real session
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
