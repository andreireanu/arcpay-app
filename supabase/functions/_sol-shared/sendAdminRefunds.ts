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

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++)
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export interface OfferRefundItem {
  ephemeralId: string;
  buyerWallet: string;
  sellerWallet?: string; // present for listing cancel (vault refund), absent for accepted (rent only)
}

export interface RefundResult {
  signatures: string[];
  errors: Array<{ items: OfferRefundItem[]; error: string }>;
}

// Max 10 items per tx: backend + config + system_program (3 shared) + 3 unique per item
// (offer_record, buyer, vault) = 3 + 10*3 = 33 accounts, within the 35 account limit.
export const BATCH_SIZE = 10;

// Base network fee the backend pays as fee payer, per batched transaction (one signature).
export const NETWORK_FEE_PER_TX = 5000;

export async function sendAdminRefunds(
  connection: Connection,
  backendKeypair: Keypair,
  programId: PublicKey,
  items: OfferRefundItem[],
): Promise<RefundResult> {
  const disc = await getDiscriminator("admin_refund_offer");
  const [configPda] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("config")],
    programId,
  );

  const signatures: string[] = [];
  const errors: Array<{ items: OfferRefundItem[]; error: string }> = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash();

    const tx = new Transaction();
    tx.recentBlockhash = blockhash;
    tx.feePayer = backendKeypair.publicKey;

    for (const item of batch) {
      const uuidBytes = uuidToBytes(item.ephemeralId);
      const buyerPubkey = new PublicKey(item.buyerWallet);

      const [offerRecordPda] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("offer"), uuidBytes],
        programId,
      );

      // Vault: Some (listing cancel) or None (accepted offer, rent only).
      // Anchor treats the account as None when its key equals the running program's own ID.
      const vaultAccountMeta = item.sellerWallet
        ? (() => {
            const [vaultPda] = PublicKey.findProgramAddressSync(
              [
                new TextEncoder().encode("vault"),
                new PublicKey(item.sellerWallet).toBytes(),
              ],
              programId,
            );
            return { pubkey: vaultPda, isSigner: false, isWritable: true };
          })()
        : { pubkey: programId, isSigner: false, isWritable: false };

      const data = new Uint8Array(24);
      data.set(disc, 0);
      data.set(uuidBytes, 8);

      tx.add(
        new TransactionInstruction({
          programId,
          keys: [
            { pubkey: backendKeypair.publicKey, isSigner: true, isWritable: true },
            { pubkey: configPda, isSigner: false, isWritable: false },
            { pubkey: offerRecordPda, isSigner: false, isWritable: true },
            { pubkey: buyerPubkey, isSigner: false, isWritable: true },
            vaultAccountMeta,
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
      errors.push({ items: batch, error: String(e) });
    }
  }

  return { signatures, errors };
}
