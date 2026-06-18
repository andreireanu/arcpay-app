import { Transaction } from "@mysten/sui/transactions";
import type { SuiWallet } from "@dynamic-labs/sui-core";
import { CONFIG_ID, CLOCK_ID, target } from "../package";
import { suiClient } from "../client";
import { getSellerCancelAuth } from "../../supabase/authorize/sellerCancelAuthorize";

function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
  return bytes;
}

export async function sellerCancelOffer(
  wallet: SuiWallet,
  offerId: string,
): Promise<string> {
  const auth = await getSellerCancelAuth(offerId, wallet.address);

  const tx = new Transaction();
  tx.setSender(wallet.address);
  tx.moveCall({
    target: target("offer", "seller_cancel_offer"),
    arguments: [
      tx.object(CONFIG_ID),
      tx.pure.vector("u8", uuidToBytes(offerId)),
      tx.pure.u64(BigInt(auth.expiry)),
      tx.pure.vector(
        "u8",
        Array.from(Uint8Array.from(atob(auth.signature), (c) => c.charCodeAt(0))),
      ),
      tx.object(CLOCK_ID),
    ],
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
      `Sui seller cancel failed: ${res.effects?.status.error ?? "unknown error"}`,
    );
  }
  return res.digest;
}
