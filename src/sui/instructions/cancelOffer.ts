import { Transaction } from "@mysten/sui/transactions";
import type { SuiWallet } from "@dynamic-labs/sui-core";
import { CLOCK_ID, target } from "../package";
import { suiClient } from "../client";

export async function cancelOffer(
  wallet: SuiWallet,
  objectId: string,
): Promise<string> {
  const tx = new Transaction();
  tx.setSender(wallet.address);
  tx.moveCall({
    target: target("offer", "buyer_cancel_offer"),
    arguments: [tx.object(objectId), tx.object(CLOCK_ID)],
  });

  const builtBytes = await tx.build({ client: suiClient });
  const { bytes, signature } = await wallet.signTransaction(
    Transaction.from(builtBytes),
  );

  const res = await suiClient.executeTransactionBlock({
    transactionBlock: bytes,
    signature,
    options: { showEffects: true },
  });

  if (res.effects?.status.status !== "success") {
    throw new Error(
      `Sui cancel offer failed: ${res.effects?.status.error ?? "unknown error"}`,
    );
  }
  return res.digest;
}
