import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  makeSuiClient,
  sendAdminSettles,
  suiKeypairFromHex,
  type SuiSettleItem,
} from "../_sui-shared/sendAdminSettles.ts";

// Accepts a uuid as a uuid string, a 32-char hex string, or a 16-element byte
// array, and normalizes to the canonical uuid stored in the DB.
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

  let payload;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // The indexer tags each decoded event with its Move struct name.
  if (payload.event === "SellerOfferCanceled") {
    return handleSellerCancel(supabase, payload);
  }
  return handleBuyerCancel(supabase, payload);
});

// BuyerOfferCanceled: the buyer withdrew their own counter offer. The on-chain
// buyer_cancel_offer returned the full escrow to the buyer and deleted the Offer
// object, so mark the escrow returned/closed.
async function handleBuyerCancel(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<Response> {
  let ephemeralUuid: string;
  try {
    ephemeralUuid = normalizeUuid(payload.uuid);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Bad uuid", {
      status: 400,
    });
  }

  const txDigest = typeof payload.tx_digest === "string" ? payload.tx_digest : "";
  console.log("sui-cancel-webhook buyer_cancel", ephemeralUuid, "digest", txDigest);

  const { data: canceledRows, error } = await supabase
    .from("qr_counteroffers")
    .update({
      status: "buyer_canceled",
      returned: true,
      settle_tx_signature: txDigest,
      confirmed_at: new Date().toISOString(),
    })
    .eq("ephemeral_id", ephemeralUuid)
    .eq("chain", "sui")
    .select("id");

  if (error) {
    console.error("buyer_canceled update error", ephemeralUuid, error);
    return new Response("Internal error", { status: 500 });
  }

  console.log("buyer_canceled", ephemeralUuid);
  await dropHiddenMarkers(supabase, canceledRows);
  return new Response("ok", { status: 200 });
}

// SellerOfferCanceled: the seller canceled their own offer. Reconcile the DB,
// then admin_settle_offer each active counter offer with to_seller=false to
// refund the escrow to its buyer.
async function handleSellerCancel(
  supabase: SupabaseClient,
  payload: Record<string, unknown>,
): Promise<Response> {
  let offerId: string;
  try {
    offerId = normalizeUuid(payload.offer_id);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Bad offer_id", {
      status: 400,
    });
  }

  const seller = typeof payload.seller === "string" ? payload.seller : "";
  if (!seller) return new Response("Missing seller", { status: 400 });

  console.log("sui-cancel-webhook seller_cancel", offerId, "seller", seller);

  // The event's seller field is the tx signer, so matching it against the
  // listing's owner verifies the cancel was signed by that owner. Anyone can
  // emit this event with any offer_id — without this check a spoofed event
  // marks someone else's listing canceled in the DB.
  const { data: offerRow, error: lookupError } = await supabase
    .from("qr_offers")
    .select("seller_wallet, chain")
    .eq("id", offerId)
    .maybeSingle();

  if (lookupError || !offerRow) {
    console.error("qr_offers lookup failed", offerId, lookupError);
    return new Response("Offer not found", { status: 404 });
  }
  if (offerRow.seller_wallet !== seller) {
    console.warn("spoofed seller_cancel ignored", offerId, "signer", seller);
    return new Response("ok (ignored)", { status: 200 });
  }

  const { data: counterOffers, error: fetchError } = await supabase
    .from("qr_counteroffers")
    .select("id, ephemeral_id, sui_object_id")
    .eq("offer_id", offerId)
    .eq("status", "active");

  if (fetchError) {
    console.error("qr_counteroffers fetch error", offerId, fetchError);
    return new Response("Internal error", { status: 500 });
  }

  const { error: offerUpdateError } = await supabase
    .from("qr_offers")
    .update({ status: "canceled" })
    .eq("id", offerId);

  if (offerUpdateError) {
    console.error("qr_offers update error", offerId, offerUpdateError);
    return new Response("Internal error", { status: 500 });
  }
  console.log("offer marked canceled", offerId);

  if (!counterOffers || counterOffers.length === 0) {
    console.log("no active counter offers for offer", offerId);
    return new Response("ok", { status: 200 });
  }

  const { error: updateError } = await supabase
    .from("qr_counteroffers")
    .update({ status: "seller_canceled" })
    .in("ephemeral_id", counterOffers.map((co) => co.ephemeral_id));

  if (updateError)
    console.error("qr_counteroffers update error", offerId, updateError);
  else
    console.log("counter offers marked seller_canceled", offerId, counterOffers.length);

  await dropHiddenMarkers(supabase, counterOffers);
  await refundCounterOffers(offerId, counterOffers);
  return new Response("ok", { status: 200 });
}

// Refund every active counter offer's escrow back to its buyer via
// admin_settle_offer(to_seller=false, fee=0), batched into PTBs. The backend
// keypair signs as config.backend_address(); it must hold SUI for gas.
async function refundCounterOffers(
  offerId: string,
  counterOffers: { sui_object_id: string | null }[],
): Promise<void> {
  const items: SuiSettleItem[] = counterOffers
    .filter((co) => co.sui_object_id)
    .map((co) => ({ objectId: co.sui_object_id!, toSeller: false, feeAmount: 0 }));

  if (items.length === 0) {
    console.warn("no settleable sui_object_id for offer", offerId);
    return;
  }

  const packageId = Deno.env.get("SUI_PACKAGE_ID");
  const configId = Deno.env.get("SUI_CONFIG_ID");
  const keypairHex = Deno.env.get("SUI_BACKEND_KEYPAIR");
  if (!packageId || !configId || !keypairHex) {
    console.error(
      "missing SUI_PACKAGE_ID / SUI_CONFIG_ID / SUI_BACKEND_KEYPAIR — refunds skipped",
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

  if (digests.length) console.log("admin refunds sent", offerId, digests);
  if (dropped.length)
    console.warn(
      "objects already consumed on chain, skipped",
      offerId,
      dropped.map((d) => d.objectId),
    );
  if (errors.length) console.error("admin refund errors", offerId, errors);
}

// Drop any seller hidden-markers for now-canceled counter offers.
async function dropHiddenMarkers(
  supabase: SupabaseClient,
  rows: { id: string }[] | null,
): Promise<void> {
  if (!rows || rows.length === 0) return;
  const { error } = await supabase
    .from("qr_counteroffers_seller_state")
    .delete()
    .in("counteroffer_id", rows.map((r) => r.id));
  if (error) console.error("seller_state cleanup error", error);
}
