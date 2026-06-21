import { PublicKey } from "@solana/web3.js";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
import type { AnchorWallet } from "@solana/wallet-adapter-react";

type DynamicWallet = Parameters<typeof isSolanaWallet>[0];

// Adapt a connected Dynamic wallet to the AnchorWallet shape the Solana
// instruction builders expect. Keeps the @solana/web3.js dependency inside
// src/solana, and centralizes the adapter that was duplicated across callers.
// Throws if the wallet isn't a Solana wallet.
export async function toAnchorWallet(
  wallet: DynamicWallet,
): Promise<AnchorWallet> {
  if (!isSolanaWallet(wallet)) {
    throw new Error("A Solana wallet is required for this action");
  }
  const signer = await wallet.getSigner();
  return {
    publicKey: new PublicKey(wallet.address),
    signTransaction: signer.signTransaction.bind(signer),
    signAllTransactions: signer.signAllTransactions.bind(signer),
  } as unknown as AnchorWallet;
}
