import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "npm:@solana/web3.js@1";

async function getDiscriminator(name: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`global:${name}`),
  );
  return new Uint8Array(hash, 0, 8);
}

export function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++)
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export interface OfferSettleItem {
  ephemeralId: string;
  buyerWallet: string;
  sellerWallet: string;
  /** true: accepted offer (amount − fee → seller); false: refund (amount → buyer) */
  toSeller: boolean;
  /** lamports; must be 0 when toSeller is false (the program enforces it) */
  feeAmount: number;
}

export interface SettleResult {
  signatures: string[];
  /** records no longer on chain — already settled or canceled by their buyer */
  dropped: OfferSettleItem[];
  errors: Array<{ items: OfferSettleItem[]; error: string }>;
}

// Max 10 items per tx: backend + config + system_program (3 shared) + 3 per item
// (offer_record, buyer, seller) = 33 accounts worst case, within limits.
export const BATCH_SIZE = 10;

// Base network fee the backend pays as fee payer, per batched transaction (one
// signature). The program reimburses TX_FEE (5000) per settled record.
export const NETWORK_FEE_PER_TX = 5000;

const MAX_ATTEMPTS = 3;

function recordPda(programId: PublicKey, ephemeralId: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("offer"), uuidToBytes(ephemeralId)],
    programId,
  )[0];
}

// Drop items whose offer record no longer exists on chain. The DB may lag the
// chain (a buyer cancel whose webhook hasn't been processed yet), and a settle
// batch is one atomic tx — a single missing record would fail all 10
// instructions. The chain, not the DB, decides what is still settleable.
async function filterExisting(
  connection: Connection,
  programId: PublicKey,
  items: OfferSettleItem[],
): Promise<{ alive: OfferSettleItem[]; dropped: OfferSettleItem[] }> {
  const alive: OfferSettleItem[] = [];
  const dropped: OfferSettleItem[] = [];
  for (let i = 0; i < items.length; i += 100) {
    const chunk = items.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(
      chunk.map((it) => recordPda(programId, it.ephemeralId)),
      "confirmed",
    );
    chunk.forEach((it, j) => (infos[j] ? alive : dropped).push(it));
  }
  return { alive, dropped };
}

export async function sendAdminSettles(
  connection: Connection,
  backendKeypair: Keypair,
  programId: PublicKey,
  items: OfferSettleItem[],
): Promise<SettleResult> {
  const disc = await getDiscriminator("admin_settle_offer");
  const [configPda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("config")],
    programId,
  );

  const signatures: string[] = [];
  const dropped: OfferSettleItem[] = [];
  const errors: Array<{ items: OfferSettleItem[]; error: string }> = [];

  let remaining = [...items];
  let lastError = "";

  // Pre-filter + send + retry until convergence: a record consumed between the
  // filter and execution fails its batch; the next attempt re-filters and
  // resends the survivors.
  for (let attempt = 0; attempt < MAX_ATTEMPTS && remaining.length > 0; attempt++) {
    const filtered = await filterExisting(connection, programId, remaining);
    dropped.push(...filtered.dropped);
    remaining = [];

    for (let i = 0; i < filtered.alive.length; i += BATCH_SIZE) {
      const batch = filtered.alive.slice(i, i + BATCH_SIZE);
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();

      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = backendKeypair.publicKey;

      for (const item of batch) {
        // admin_settle_offer(uuid: [u8;16], to_seller: bool, fee_amount: u64)
        const data = new Uint8Array(8 + 16 + 1 + 8);
        data.set(disc, 0);
        data.set(uuidToBytes(item.ephemeralId), 8);
        data[24] = item.toSeller ? 1 : 0;
        new DataView(data.buffer).setBigUint64(25, BigInt(item.feeAmount), true);

        tx.add(
          new TransactionInstruction({
            programId,
            keys: [
              { pubkey: backendKeypair.publicKey, isSigner: true, isWritable: true },
              { pubkey: configPda, isSigner: false, isWritable: true },
              { pubkey: recordPda(programId, item.ephemeralId), isSigner: false, isWritable: true },
              { pubkey: new PublicKey(item.buyerWallet), isSigner: false, isWritable: true },
              { pubkey: new PublicKey(item.sellerWallet), isSigner: false, isWritable: true },
              { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            data,
          }),
        );
      }

      tx.sign(backendKeypair);

      try {
        const sig = await connection.sendRawTransaction(tx.serialize(), {
          skipPreflight: false,
        });
        await connection.confirmTransaction(
          { signature: sig, blockhash, lastValidBlockHeight },
          "confirmed",
        );
        signatures.push(sig);
      } catch (e) {
        lastError = String(e);
        remaining.push(...batch);
      }
    }
  }

  if (remaining.length > 0) {
    errors.push({ items: remaining, error: lastError || "unsettled after retries" });
  }

  return { signatures, dropped, errors };
}
