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

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response("Missing authorization header", { status: 401, headers: corsHeaders });
  }
  const dynamicToken = authHeader.slice(7);

  const { wallet_address: walletAddress, role } = await req.json();
  if (!walletAddress) {
    return new Response("Missing wallet_address", { status: 400, headers: corsHeaders });
  }
  const userRole: string = role === "buyer" ? "buyer" : "seller";

  const dynamicEnvId = Deno.env.get("DYNAMIC_ENV_ID")!;

  try {
    const JWKS = jose.createRemoteJWKSet(
      new URL(`https://app.dynamic.xyz/api/v0/sdk/${dynamicEnvId}/.well-known/jwks`),
    );
    await jose.jwtVerify(dynamicToken, JWKS);
  } catch (err) {
    console.error("Dynamic token verification failed", err);
    return new Response("Invalid Dynamic token", { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const supabaseAnon = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);

  const internalEmail = `${walletAddress}@wallet.arcpay`;
  const siteUrl = Deno.env.get("SITE_URL") ?? "http://localhost:5173";

  // Update role in user_metadata on every login so it reflects the current entry point.
  await supabaseAdmin.auth.admin.listUsers().then(async ({ data }) => {
    const existing = data.users.find((u) => u.email === internalEmail);
    if (existing) {
      await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        user_metadata: { wallet_address: walletAddress, role: userRole },
      });
    }
  });

  let { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email: internalEmail,
    options: { redirectTo: siteUrl },
  });

  if (linkError) {
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: internalEmail,
      email_confirm: true,
      user_metadata: { wallet_address: walletAddress, role: userRole },
    });
    if (createError) {
      console.error("Failed to create Supabase user", createError);
      return new Response("Failed to create user", { status: 500, headers: corsHeaders });
    }

    ({ data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: internalEmail,
      options: { redirectTo: siteUrl },
    }));
  }

  if (linkError || !linkData) {
    console.error("Failed to generate session link", linkError);
    return new Response("Failed to create session", { status: 500, headers: corsHeaders });
  }

  const linkType = new URL(linkData.properties.action_link).searchParams.get("type") as "signup" | "magiclink" | "recovery";

  const { data: sessionData, error: sessionError } = await supabaseAnon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: linkType,
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
