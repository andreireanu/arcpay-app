import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  makeSuiClient,
  sendAdminSettles,
  suiKeypairFromHex,
  type SuiSettleItem,
} from "../_sui-shared/sendAdminSettles.ts";
import {
  evaluateAutoAccept,
  markAutoAcceptTriggered,
} from "../_shared/autoAccept.ts";

// Accepts a uuid as a uuid string, a 32-char hex string, or a 16-element byte
// array, and normalizes to the canonical uuid stored in qr_ephemeral.id.
function normalizeUuid(input: unknown): string {
  if (Array.isArray(input)) {
    const hex = input
      .map((b) => Number(b).toString(16).padStart(2, "0"))
      .join("");
    return hexToUuid(hex);
  }
  if (typeof input === "string") {
    if (input.includes("-")) return input.toLowerCase();
    return hexToUuid(input.replace(/^0x/, ""));
  }
  throw new Error("uuid must be a uuid, hex string, or byte array");
}

function hexToUuid(hex: string): string {
  if (hex.length !== 32)
    throw new Error(`uuid must be 16 bytes, got ${hex.length / 2}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

Deno.serve(async (req) => {
  // Server-to-server call from our own indexer — authenticate with a shared
  // secret (the JWT gateway check is off via config.toml).
  const secret = Deno.env.get("SUI_WEBHOOK_SECRET");
  if (secret && req.headers.get("authorization") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event;
  try {
    event = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const txSignature: string = event.tx_digest ?? "";
  if (!txSignature) return new Response("Missing tx_digest", { status: 400 });

  // The on-chain shared Offer object id — stored so the offer can later be
  // canceled/settled on Sui.
  const suiObjectId: string = event.object_id ?? "";
  if (!suiObjectId) return new Response("Missing object_id", { status: 400 });

  let ephemeralUuid: string;
  try {
    ephemeralUuid = normalizeUuid(event.uuid);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Bad uuid", {
      status: 400,
    });
  }

  const buyerWallet: string = event.buyer ?? "";
  const amount = Number(event.amount);
  if (!buyerWallet || !Number.isFinite(amount)) {
    return new Response("Missing or invalid fields", { status: 400 });
  }

  console.log(
    "sui-counteroffer-webhook offer_created",
    ephemeralUuid,
    "buyer",
    buyerWallet,
    "amount",
    amount,
    "object",
    suiObjectId,
  );

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Look up the real offer_id from the ephemeral uuid mapping, and the parent
  // offer's fee_bps so we can persist the seller/fee split.
  const { data: ephemeral, error: lookupError } = await supabase
    .from("qr_ephemeral")
    .select("id, offer_id, qr_offers(fee_bps)")
    .eq("id", ephemeralUuid)
    .maybeSingle();

  if (lookupError || !ephemeral) {
    const { data: existing } = await supabase
      .from("qr_counteroffers")
      .select("id")
      .eq("tx_signature", txSignature)
      .maybeSingle();
    if (existing) {
      console.warn("duplicate delivery, skipping", txSignature);
      return new Response("ok (duplicate)", { status: 200 });
    }
    console.error("qr_ephemeral lookup failed", ephemeralUuid, lookupError);
    return new Response("Unknown ephemeral uuid", { status: 404 });
  }

  // Carve the protocol fee out of the locked amount using the parent offer's
  // fee_bps, persisting the seller/fee split (the same split the seller will
  // later sign and the program will enforce on accept).
  const feeBps =
    (ephemeral.qr_offers as { fee_bps: number | null } | null)?.fee_bps ?? 0;
  const feeAmount = Math.floor((amount * feeBps) / 10000);
  const sellerAmount = amount - feeAmount;

  // Insert counter offer — skip if tx_signature already exists (duplicate delivery).
  const { error: insertError } = await supabase
    .from("qr_counteroffers")
    .insert({
      offer_id: ephemeral.offer_id,
      ephemeral_id: ephemeral.id,
      buyer_wallet: buyerWallet,
      tx_signature: txSignature,
      seller_amount: sellerAmount,
      fee_amount: feeAmount,
      sui_object_id: suiObjectId,
      chain: "sui",
    });

  if (insertError) {
    if (insertError.code === "23505") {
      console.warn("duplicate delivery, skipping", txSignature);
      return new Response("ok (duplicate)", { status: 200 });
    }
    console.error("qr_counteroffers insert error", insertError);
    return new Response("Internal error", { status: 500 });
  }

  // Delete the ephemeral row now that it has been consumed.
  const { error: deleteError } = await supabase
    .from("qr_ephemeral")
    .delete()
    .eq("id", ephemeral.id);

  if (deleteError) console.error("qr_ephemeral delete error", deleteError);
  else
    console.log(
      "deleted ephemeral",
      ephemeralUuid,
      "offer",
      ephemeral.offer_id,
    );

  await runAutoAccept(supabase, ephemeral.offer_id);

  return new Response("ok", { status: 200 });
});

// Evaluate the seller's auto-accept rule for this offer and, if met, settle the
// best counter offers to the seller via admin_settle_offer (to_seller=true) —
// the same settle path the accept flow uses, just triggered by the stored rule
// instead of an on-chain consent event.
async function runAutoAccept(
  supabase: SupabaseClient,
  offerId: string,
): Promise<void> {
  const decision = await evaluateAutoAccept(supabase, offerId);
  if (!decision) return;

  const items: SuiSettleItem[] = decision.rows
    .filter((co) => co.sui_object_id)
    .map((co) => ({
      objectId: co.sui_object_id!,
      toSeller: true,
      feeAmount: co.fee_amount,
      auto: true,
    }));
  if (items.length === 0) return;

  const packageId = Deno.env.get("SUI_PACKAGE_ID");
  const configId = Deno.env.get("SUI_CONFIG_ID");
  const keypairHex = Deno.env.get("SUI_BACKEND_KEYPAIR");
  if (!packageId || !configId || !keypairHex) {
    console.error(
      "auto-accept: missing SUI_PACKAGE_ID / SUI_CONFIG_ID / SUI_BACKEND_KEYPAIR — skipped",
      offerId,
    );
    return;
  }

  const client = makeSuiClient();
  const keypair = suiKeypairFromHex(keypairHex);

  const { digests, dropped, errors } = await sendAdminSettles(
    client,
    keypair,
    packageId,
    configId,
    items,
  );

  if (digests.length) console.log("auto-accept settled", offerId, digests);
  if (dropped.length)
    console.warn(
      "auto-accept objects already consumed, skipped",
      offerId,
      dropped.map((d) => d.objectId),
    );
  if (errors.length) {
    // Leave the rule armed so the next counter offer re-runs the driver.
    console.error("auto-accept errors", offerId, errors);
    return;
  }

  await markAutoAcceptTriggered(supabase, offerId, decision.achievedAvg);
}
