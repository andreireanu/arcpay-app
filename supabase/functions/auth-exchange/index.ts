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
  console.log("[1] Got Dynamic token, length:", dynamicToken.length);

  // 2. Extract wallet address from request body
  const { wallet_address: walletAddress } = await req.json();
  if (!walletAddress) {
    return new Response("Missing wallet_address", { status: 400, headers: corsHeaders });
  }
  console.log("[2] walletAddress:", walletAddress);

  const dynamicEnvId = Deno.env.get("DYNAMIC_ENV_ID")!;
  console.log("[3] dynamicEnvId present:", !!dynamicEnvId);

  // 3. Verify the Dynamic token via JWKS
  try {
    const JWKS = jose.createRemoteJWKSet(
      new URL(`https://app.dynamic.xyz/api/v0/sdk/${dynamicEnvId}/.well-known/jwks`),
    );
    const { payload } = await jose.jwtVerify(dynamicToken, JWKS);
    console.log("[3] JWT verified OK, sub:", payload.sub, "iss:", payload.iss);
  } catch (err) {
    console.error("[3] Dynamic token verification failed", err);
    return new Response("Invalid Dynamic token", { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const supabaseAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);

  // 4. Find or create a Supabase auth user keyed by wallet address
  const internalEmail = `${walletAddress}@wallet.arcpay`;
  console.log("[4] internalEmail:", internalEmail);

  const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:5173";

  // Try generateLink first — works if user already exists
  let { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: internalEmail,
    options: { redirectTo: siteUrl },
  });
  console.log("[4] first generateLink — linkData:", !!linkData, "linkError:", linkError?.message ?? null);

  if (linkError) {
    console.log("[4] user not found, creating...");
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: internalEmail,
      email_confirm: true,
      user_metadata: { wallet_address: walletAddress },
    });
    console.log("[4] createUser — user:", newUser?.user?.id ?? null, "error:", createError?.message ?? null);
    if (createError) {
      return new Response("Failed to create user", { status: 500, headers: corsHeaders });
    }

    ({ data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: internalEmail,
      options: { redirectTo: siteUrl },
    }));
    console.log("[4] second generateLink — linkData:", !!linkData, "linkError:", linkError?.message ?? null);
  }

  if (linkError || !linkData) {
    console.error("[4] Could not generate link", linkError);
    return new Response("Failed to create session", { status: 500, headers: corsHeaders });
  }

  console.log("[5] hashed_token present:", !!linkData.properties.hashed_token);
  console.log("[5] hashed_token:", linkData.properties.hashed_token);
  console.log("[5] action_link:", linkData.properties.action_link);

  // Read the actual OTP type from the generated link — Supabase may return "signup" instead of "magiclink"
  const linkType = new URL(linkData.properties.action_link).searchParams.get("type") as "signup" | "magiclink" | "recovery";
  console.log("[5] using link type:", linkType);

  // 5. Exchange the magic link token for a real session
  const { data: sessionData, error: sessionError } = await supabaseAnon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: linkType,
  });
  console.log("[5] verifyOtp — session:", !!sessionData?.session, "error:", sessionError?.message ?? null, "code:", (sessionError as any)?.code ?? null);

  if (sessionError || !sessionData.session) {
    console.error("[5] Failed to exchange token for session", sessionError);
    return new Response("Failed to create session", { status: 500, headers: corsHeaders });
  }

  console.log("[6] Success, returning session tokens");
  return Response.json({
    access_token: sessionData.session.access_token,
    refresh_token: sessionData.session.refresh_token,
  }, { headers: corsHeaders });
});
