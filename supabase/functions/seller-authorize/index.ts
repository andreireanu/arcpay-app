import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nacl from "https://esm.sh/tweetnacl@1.0.3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-client-info, apikey",
};

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Decode(s: string): Uint8Array {
  let n = 0n;
  for (const c of s) n = n * 58n + BigInt(BASE58.indexOf(c));
  const bytes: number[] = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  const leadingZeros = s.match(/^1*/)?.[0].length ?? 0;
  return new Uint8Array([...Array(leadingZeros).fill(0), ...bytes]);
}

function base58Encode(bytes: Uint8Array): string {
  let n = bytes.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  const chars: string[] = [];
  while (n > 0n) { chars.unshift(BASE58[Number(n % 58n)]); n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; chars.unshift("1"); }
  return chars.join("");
}

function pubkeyToBytes(address: string): Uint8Array {
  const decoded = base58Decode(address);
  const out = new Uint8Array(32);
  out.set(decoded, 32 - decoded.length);
  return out;
}

// A Sui address is a 32-byte value written as 0x + 64 hex (leading zeros may be
// trimmed). `sui::address::to_bytes` yields those 32 bytes, which is what the
// contract hashes into the auth message.
function suiAddressBytes(addr: string): Uint8Array {
  const hex = addr.replace(/^0x/, "").padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

// Sui ed25519 seed (hexWithoutFlag — the raw 32-byte private key) → keypair.
function suiKeypairFromHex(hex: string): { secretKey: Uint8Array; publicKey: Uint8Array } {
  const clean = hex.trim().replace(/^0x/, "");
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  const pair = nacl.sign.keyPair.fromSeed(seed);
  return { secretKey: pair.secretKey, publicKey: pair.publicKey };
}

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

interface SignedSeller {
  signature: string;
  expiry: number;
  backendPublicKey: string;
}

// Signed message layout (56 bytes), little-endian:
//   [0..32] seller | [32..48] offer_id | [48..56] expiry_ms
//
// Shared by seller accept and seller cancel — the backend attests the offer
// belongs to the seller. For accept, offer_id is the ephemeral witness uuid
// (qr_accepted_counter.id); for cancel, it is the offer's own uuid. Only three
// things differ by chain: the backend key, how an address encodes to 32 bytes
// (Solana base58 pubkey vs Sui 0x-hex), and the expiry unit (Solana's clock is
// unix SECONDS, Sui's Clock is MS).
function signSeller(chain: string, sellerWallet: string, offerUuid: string): SignedSeller {
  const isSui = chain === "sui";

  let secretKey: Uint8Array;
  let sellerBytes: Uint8Array;
  let expiry: bigint;
  let backendPublicKey: string;

  if (isSui) {
    const parsed = suiKeypairFromHex(Deno.env.get("SUI_BACKEND_KEYPAIR")!);
    secretKey = parsed.secretKey;
    sellerBytes = suiAddressBytes(sellerWallet);
    expiry = BigInt(Date.now() + 300_000); // ms — Sui Clock is millisecond-based
    backendPublicKey =
      "0x" + [...parsed.publicKey].map((b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    const kp = new Uint8Array(JSON.parse(Deno.env.get("SOL_BACKEND_KEYPAIR")!));
    secretKey = kp;
    sellerBytes = pubkeyToBytes(sellerWallet);
    expiry = BigInt(Math.floor(Date.now() / 1000) + 300); // seconds — Solana clock
    backendPublicKey = base58Encode(kp.slice(32));
  }

  const expiryBytes = new Uint8Array(8);
  // Unsigned LE u64 — matches both Solana's i64 (positive) and Sui's bcs u64.
  new DataView(expiryBytes.buffer).setBigUint64(0, expiry, true);

  const message = new Uint8Array(56);
  message.set(sellerBytes, 0);
  message.set(uuidToBytes(offerUuid), 32);
  message.set(expiryBytes, 48);

  const signature = nacl.sign.detached(message, secretKey);
  return {
    signature: btoa(String.fromCharCode(...signature)),
    expiry: Number(expiry),
    backendPublicKey,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const { counter_offer_ids, offer_id, seller_wallet } = await req.json();
  if (!seller_wallet) {
    return new Response("Missing seller_wallet", { status: 400, headers: CORS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Cancel: the seller cancels their own offer ──────────────────────────────
  // Signs the offer's own uuid. No witness row and no amounts — settlement is a
  // separate flow; this only attests ownership so the contract emits the cancel
  // event.
  if (offer_id) {
    const { data: offer, error } = await supabase
      .from("qr_offers")
      .select("seller_wallet, chain")
      .eq("id", offer_id)
      .maybeSingle();

    if (error || !offer) return new Response("Offer not found", { status: 404, headers: CORS });
    if (offer.seller_wallet !== seller_wallet) {
      return new Response("Unauthorized: offer does not belong to this seller", { status: 403, headers: CORS });
    }

    const signed = signSeller(offer.chain, seller_wallet, offer_id);
    return Response.json({ ...signed, sellerWallet: seller_wallet }, { headers: CORS });
  }

  // ── Accept: the seller accepts a set of counter offers ──────────────────────
  if (!Array.isArray(counter_offer_ids) || counter_offer_ids.length === 0) {
    return new Response("provide offer_id (cancel) or counter_offer_ids (accept)", { status: 400, headers: CORS });
  }

  // Fetch all counter offers and join with their parent offer to verify seller
  // ownership and read the chain. No amounts are signed: the accept is a
  // consent-only event, and settlement reads each record's escrow + stored fee
  // split per offer.
  const { data: counterOffers, error: fetchError } = await supabase
    .from("qr_counteroffers")
    .select(
      "id, status, expiry_at, offer_id, qr_offers(seller_wallet, chain, name, unlimited, quantity, quantity_sold)",
    )
    .in("id", counter_offer_ids);

  if (fetchError || !counterOffers) {
    console.error("fetch error", fetchError);
    return new Response("Internal error", { status: 500, headers: CORS });
  }

  if (counterOffers.length !== counter_offer_ids.length) {
    return new Response("One or more counter offers not found", { status: 404, headers: CORS });
  }

  type ParentOffer = {
    seller_wallet: string;
    chain: string;
    name: string;
    unlimited: boolean;
    quantity: number;
    quantity_sold: number;
  };

  let chain = "solana";
  // Tally how many offers are being accepted per parent listing. A batch can pool
  // counter offers across multiple listings (dashboard "Accept all"), so stock is
  // checked per listing. Each settle consumes one unit (quantity_sold += 1).
  const perOffer = new Map<string, { name: string; remaining: number; count: number }>();
  for (const co of counterOffers) {
    const offer = co.qr_offers as ParentOffer | null;
    if (offer?.seller_wallet !== seller_wallet) {
      return new Response("Unauthorized: counter offer does not belong to this seller", { status: 403, headers: CORS });
    }
    if (co.status !== "active") {
      return new Response(`Counter offer ${co.id} is not active`, { status: 400, headers: CORS });
    }
    if (new Date(co.expiry_at) <= new Date()) {
      return new Response(`Counter offer ${co.id} has expired`, { status: 400, headers: CORS });
    }
    chain = offer.chain;
    if (!offer.unlimited) {
      const entry = perOffer.get(co.offer_id) ?? {
        name: offer.name,
        remaining: offer.quantity - offer.quantity_sold,
        count: 0,
      };
      entry.count += 1;
      perOffer.set(co.offer_id, entry);
    }
  }

  // Reject the whole batch if accepting would oversell any listing.
  const overstock = [...perOffer.values()].filter((o) => o.count > o.remaining);
  if (overstock.length > 0) {
    const detail = overstock
      .map((o) => `“${o.name}” — only ${Math.max(0, o.remaining)} left but ${o.count} selected`)
      .join("; ");
    return new Response(`Not enough stock for ${detail}.`, {
      status: 409,
      headers: CORS,
    });
  }

  // Insert witness row — id is the ephemeral UUID passed to the program.
  const { data: witness, error: insertError } = await supabase
    .from("qr_accepted_counter")
    .insert({ offers: counter_offer_ids, status: "pending" })
    .select("id")
    .single();

  if (insertError || !witness) {
    console.error("insert error", insertError);
    return new Response("Internal error", { status: 500, headers: CORS });
  }

  const ephemeralUuid = witness.id as string;
  const signed = signSeller(chain, seller_wallet, ephemeralUuid);
  return Response.json({ ephemeralUuid, ...signed }, { headers: CORS });
});
