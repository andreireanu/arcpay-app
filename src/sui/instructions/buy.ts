import { Transaction } from "@mysten/sui/transactions";
import type { SuiWallet } from "@dynamic-labs/sui-core";
import { CONFIG_ID, CLOCK_ID, target } from "../package";
import { suiClient } from "../client";
import { ensureWalletConnected } from "../ensureConnected";
import { getBuyAuth } from "../../supabase/authorize/buyAuthorize";

function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
  return bytes;
}

export async function buy(wallet: SuiWallet, offerId: string): Promise<string> {
  await ensureWalletConnected(wallet);
  const auth = await getBuyAuth(offerId, wallet.address);
  const total = BigInt(auth.sellerAmount) + BigInt(auth.feeAmount);

  const tx = new Transaction();
  tx.setSender(wallet.address);
  const [payment] = tx.splitCoins(tx.gas, [total]);
  tx.moveCall({
    target: target("buy", "buy"),
    arguments: [
      tx.object(CONFIG_ID),
      payment,
      tx.pure.address(auth.sellerWallet),
      tx.pure.u64(BigInt(auth.sellerAmount)),
      tx.pure.u64(BigInt(auth.feeAmount)),
      tx.pure.vector("u8", uuidToBytes(offerId)),
      tx.pure.u64(BigInt(auth.expiry)),
      tx.pure.vector("u8", Array.from(auth.signature)),
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
      `Sui buy failed: ${res.effects?.status.error ?? "unknown error"}`,
    );
  }
  return res.digest;
}
