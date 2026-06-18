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
  throw new Error("offer_id must be a uuid, hex string, or byte array");
}

function hexToUuid(hex: string): string {
  if (hex.length !== 32)
    throw new Error(`offer_id must be 16 bytes, got ${hex.length / 2}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Settlement driver. seller_accept_offer moved no funds — it is the seller's
// on-chain consent for a witness uuid (qr_accepted_counter.id). This webhook
// turns that consent into one admin_settle_offer(to_seller=true) per counter
// offer (batched, pre-filtered against the chain). Counter offers are NOT marked
// confirmed here: that happens in sui-refund-webhook off each OfferBought event,
// so a crash mid-settlement loses nothing — a redelivery re-runs the driver and
// the chain filter skips whatever already settled.
Deno.serve(async (req) => {
  // Server-to-server call from our own indexer — authenticate with a shared
  // secret (the JWT gateway check is off via config.toml).
  const secret = Deno.env.get("SUI_WEBHOOK_SECRET");
  if (secret && req.headers.get("authorization") !== secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // OfferAccepted.offer_id is the witness uuid (qr_accepted_counter.id)
  let ephemeralUuid: string;
  try {
    ephemeralUuid = normalizeUuid(payload.offer_id);
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "Bad offer_id", {
      status: 400,
    });
  }

  const seller = typeof payload.seller === "string" ? payload.seller : "";
  if (!seller) return new Response("Missing seller", { status: 400 });

  console.log(
    "sui-accept-webhook offer_accepted",
    ephemeralUuid,
    "seller",
    seller,
  );

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // The witness row lists the counter offer IDs the seller consented to.
  const { data: witness, error: witnessError } = await supabase
    .from("qr_accepted_counter")
    .select("id, offers, status")
    .eq("id", ephemeralUuid)
    .maybeSingle();

  if (witnessError) {
    console.error(
      "qr_accepted_counter lookup error",
      ephemeralUuid,
      witnessError,
    );
    return new Response("Internal error", { status: 500 });
  }
  if (!witness) {
    console.error("witness not found", ephemeralUuid);
    return new Response("Witness not found", { status: 404 });
  }
  if (witness.status === "completed") {
    console.warn("witness already completed, skipping", ephemeralUuid);
    return new Response("ok (completed)", { status: 200 });
  }

  const counterOfferIds: string[] = witness.offers;

  const { data: counterOffers, error: coError } = await supabase
    .from("qr_counteroffers")
    .select(
      "id, ephemeral_id, sui_object_id, fee_amount, qr_offers(seller_wallet)",
    )
    .in("id", counterOfferIds);

  if (coError) {
    console.error("qr_counteroffers fetch error", ephemeralUuid, coError);
    return new Response("Internal error", { status: 500 });
  }
  if (!counterOffers || counterOffers.length === 0) {
    console.error("no counter offers for witness", ephemeralUuid);
    return new Response("ok (no counter offers)", { status: 200 });
  }

  // The accept event's seller must own every counter offer in the witness —
  // anything else means the witness and the on-chain consent disagree.
  const mismatched = counterOffers.filter(
    (co) =>
      (co.qr_offers as { seller_wallet: string } | null)?.seller_wallet !==
      seller,
  );
  if (mismatched.length > 0) {
    console.error(
      "seller mismatch — refusing to settle",
      ephemeralUuid,
      mismatched.map((co) => co.id),
    );
    return new Response("ok (seller mismatch)", { status: 200 });
  }

  // A Sui settle consumes the shared Offer object; without its id there is
  // nothing to settle (a Solana row would not carry one).
  const items: SuiSettleItem[] = counterOffers
    .filter((co) => co.sui_object_id)
    .map((co) => ({
      objectId: co.sui_object_id!,
      toSeller: true,
      feeAmount: co.fee_amount,
    }));

  if (items.length === 0) {
    console.warn("no settleable sui_object_id for witness", ephemeralUuid);
    return new Response("ok (nothing to settle)", { status: 200 });
  }

  const packageId = Deno.env.get("SUI_PACKAGE_ID");
  const configId = Deno.env.get("SUI_CONFIG_ID");
  const keypairHex = Deno.env.get("SUI_BACKEND_KEYPAIR");
  if (!packageId || !configId || !keypairHex) {
    console.error(
      "missing SUI_PACKAGE_ID / SUI_CONFIG_ID / SUI_BACKEND_KEYPAIR — settlement skipped",
      ephemeralUuid,
    );
    return new Response("Settlement not configured", { status: 500 });
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

  if (digests.length) console.log("settlements sent", ephemeralUuid, digests);
  if (dropped.length)
    // Already consumed on chain: settled by an earlier (re)delivery, or the
    // buyer canceled before settlement — the matching webhook records it.
    console.warn(
      "objects no longer on chain, skipped",
      ephemeralUuid,
      dropped.map((d) => d.objectId),
    );
  if (errors.length) {
    // Leave the witness pending: a redelivery re-runs the driver and the chain
    // filter makes that convergent. 5xx so the indexer retries.
    console.error("settlement errors", ephemeralUuid, errors);
    return new Response("Settlement incomplete", { status: 500 });
  }

  const { error: witnessUpdateError } = await supabase
    .from("qr_accepted_counter")
    .update({ status: "completed" })
    .eq("id", ephemeralUuid);

  if (witnessUpdateError)
    console.error(
      "qr_accepted_counter update error",
      ephemeralUuid,
      witnessUpdateError,
    );

  console.log(
    "settlement dispatched for accepted_counter",
    ephemeralUuid,
    "counter_offers",
    counterOfferIds,
  );
  return new Response("ok", { status: 200 });
});
