import type { Connection } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type { WalletAdapterProps } from "@solana/wallet-adapter-base";
import { getProgram } from "../program";

export async function register(
  connection: Connection,
  wallet: AnchorWallet,
  sendTransaction: WalletAdapterProps["sendTransaction"],
): Promise<string> {
  const program = getProgram(connection, wallet);
  const tx = await program.methods.register().transaction();
  const latestBlockhash = await connection.getLatestBlockhash();
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.feePayer = wallet.publicKey;

  const simulation = await connection.simulateTransaction(tx);
  console.log("simulation logs:", simulation.value.logs);
  if (simulation.value.err)
    console.error("simulation error:", simulation.value.err);

  const signature = await sendTransaction(tx, connection, {
    skipPreflight: true,
  });
  await connection.confirmTransaction(
    { signature, ...latestBlockhash },
    "confirmed",
  );
  return signature;
}
