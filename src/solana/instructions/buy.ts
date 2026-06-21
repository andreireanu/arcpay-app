import { Buffer } from "buffer/";
import {
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { getProgram, PROGRAM_ID } from "../program";
import { getBuyAuth } from "../../supabase/authorize/buyAuthorize";

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function buy(
  connection: Connection,
  wallet: AnchorWallet,
  offerId: string,
): Promise<string> {
  const auth = await getBuyAuth(offerId, wallet.publicKey.toBase58());

  const buyerBytes = wallet.publicKey.toBytes();
  const sellerBytes = new PublicKey(auth.sellerWallet).toBytes();
  const offerIdBytes = uuidToBytes(offerId);

  const sellerAmountBytes = new Uint8Array(8);
  const feeAmountBytes = new Uint8Array(8);
  const expiryBytes = new Uint8Array(8);
  new DataView(sellerAmountBytes.buffer).setBigUint64(
    0,
    BigInt(auth.sellerAmount),
    true,
  );
  new DataView(feeAmountBytes.buffer).setBigUint64(
    0,
    BigInt(auth.feeAmount),
    true,
  );
  new DataView(expiryBytes.buffer).setBigInt64(0, BigInt(auth.expiry), true);

  // Message layout: buyer(32) || seller(32) || offer_id(16) || seller_amount(8) || fee_amount(8) || expiry(8)
  const message = new Uint8Array(104);
  message.set(buyerBytes, 0);
  message.set(sellerBytes, 32);
  message.set(offerIdBytes, 64);
  message.set(sellerAmountBytes, 80);
  message.set(feeAmountBytes, 88);
  message.set(expiryBytes, 96);

  const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
    publicKey: new PublicKey(auth.backendPublicKey).toBytes(),
    message,
    signature: auth.signature,
  });

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID,
  );

  const program = getProgram(connection, wallet);
  const buyIx = await program.methods
    .buy(
      new BN(auth.sellerAmount),
      new BN(auth.feeAmount),
      Array.from(offerIdBytes),
      new BN(auth.expiry),
    )
    .accounts({
      buyer: wallet.publicKey,
      seller: new PublicKey(auth.sellerWallet),
      config: configPda,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
    })
    .instruction();

  const latestBlockhash = await connection.getLatestBlockhash();
  const tx = new Transaction();
  tx.add(ed25519Ix);
  tx.add(buyIx);
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = wallet.publicKey;

  const signed = await wallet.signTransaction(tx);
  const txSignature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  await connection.confirmTransaction(
    { signature: txSignature, ...latestBlockhash },
    "confirmed",
  );
  return txSignature;
}
