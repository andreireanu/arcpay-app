import type { Connection } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { getProgram } from "../program";

export async function register(
  connection: Connection,
  wallet: AnchorWallet,
): Promise<string> {
  const program = getProgram(connection, wallet);
  const tx = await program.methods.register().transaction();
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = wallet.publicKey;

  const signed = await wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: true,
  });
  await connection.confirmTransaction({ signature, ...latestBlockhash }, "confirmed");
  return signature;
}
