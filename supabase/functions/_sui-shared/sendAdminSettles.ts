import { SuiClient, getFullnodeUrl } from "npm:@mysten/sui@1.45.2/client";
import { Transaction } from "npm:@mysten/sui@1.45.2/transactions";
import { Ed25519Keypair } from "npm:@mysten/sui@1.45.2/keypairs/ed25519";

const CLOCK_ID = "0x6";

export interface SuiSettleItem {
  /** on-chain shared Offer object id (qr_counteroffers.sui_object_id) */
  objectId: string;
  /** true: accepted offer (escrow − fee → seller); false: refund (escrow → buyer) */
  toSeller: boolean;
  /** MIST; the contract asserts this is 0 when toSeller is false */
  feeAmount: number;
}

export interface SuiSettleResult {
  digests: string[];
  /** objects no longer on chain — already settled or canceled by their buyer */
  dropped: SuiSettleItem[];
  errors: Array<{ items: SuiSettleItem[]; error: string }>;
}

// One settle = one moveCall command + one Offer object input (Config/Clock/pure
// args are shared once per PTB). The PTB caps are 1024 commands / 2048 input
// objects / 128KB, so the binding constraint is tx size — 50 keeps us well
// under it and limits the blast radius if a single PTB aborts.
export const BATCH_SIZE = 50;

const MAX_ATTEMPTS = 3;

// Sui ed25519 seed (hexWithoutFlag — the raw 32-byte private key) → keypair.
// Its Sui address equals config.backend_address(), so it is authorized to call
// admin_settle_offer.
export function suiKeypairFromHex(hex: string): Ed25519Keypair {
  const clean = hex.trim().replace(/^0x/, "");
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) seed[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return Ed25519Keypair.fromSecretKey(seed);
}

export function makeSuiClient(): SuiClient {
  const rpc = Deno.env.get("SUI_RPC_URL");
  if (rpc) return new SuiClient({ url: rpc });
  const network = (Deno.env.get("SUI_NETWORK") ?? "testnet") as
    | "mainnet"
    | "testnet"
    | "devnet"
    | "localnet";
  return new SuiClient({ url: getFullnodeUrl(network) });
}

// Drop items whose Offer object no longer exists on chain. The DB may lag the
// chain (a buyer cancel whose webhook hasn't been processed yet), and a PTB is
// atomic — a single missing object would abort the whole batch. The chain, not
// the DB, decides what is still settleable.
async function filterExisting(
  client: SuiClient,
  items: SuiSettleItem[],
): Promise<{ alive: SuiSettleItem[]; dropped: SuiSettleItem[] }> {
  const alive: SuiSettleItem[] = [];
  const dropped: SuiSettleItem[] = [];
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50);
    const infos = await client.multiGetObjects({
      ids: chunk.map((it) => it.objectId),
      options: {},
    });
    chunk.forEach((it, j) => {
      const info = infos[j];
      (info?.data && !info.error ? alive : dropped).push(it);
    });
  }
  return { alive, dropped };
}

export async function sendAdminSettles(
  client: SuiClient,
  keypair: Ed25519Keypair,
  packageId: string,
  configId: string,
  items: SuiSettleItem[],
): Promise<SuiSettleResult> {
  const target = `${packageId}::offer::admin_settle_offer`;

  const digests: string[] = [];
  const dropped: SuiSettleItem[] = [];
  const errors: Array<{ items: SuiSettleItem[]; error: string }> = [];

  let remaining = [...items];
  let lastError = "";

  // Pre-filter + send + retry until convergence: an object consumed between the
  // filter and execution aborts its PTB; the next attempt re-filters and
  // resends the survivors.
  for (let attempt = 0; attempt < MAX_ATTEMPTS && remaining.length > 0; attempt++) {
    const filtered = await filterExisting(client, remaining);
    dropped.push(...filtered.dropped);
    remaining = [];

    for (let i = 0; i < filtered.alive.length; i += BATCH_SIZE) {
      const batch = filtered.alive.slice(i, i + BATCH_SIZE);

      const tx = new Transaction();
      const configArg = tx.object(configId);
      const clockArg = tx.object(CLOCK_ID);
      for (const item of batch) {
        tx.moveCall({
          target,
          arguments: [
            configArg,
            tx.object(item.objectId),
            tx.pure.bool(item.toSeller),
            tx.pure.u64(BigInt(item.feeAmount)),
            clockArg,
          ],
        });
      }

      try {
        const res = await client.signAndExecuteTransaction({
          signer: keypair,
          transaction: tx,
          options: { showEffects: true },
        });
        if (res.effects?.status.status !== "success") {
          throw new Error(res.effects?.status.error ?? "unknown error");
        }
        digests.push(res.digest);
      } catch (e) {
        lastError = String(e);
        remaining.push(...batch);
      }
    }
  }

  if (remaining.length > 0) {
    errors.push({ items: remaining, error: lastError || "unsettled after retries" });
  }

  return { digests, dropped, errors };
}
