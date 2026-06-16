import { Transaction } from "@mysten/sui/transactions";
import type { SuiWallet } from "@dynamic-labs/sui-core";
import { CONFIG_ID, CLOCK_ID, target } from "../package";
import { suiClient } from "../client";
import { getBuyAuth } from "../../supabase/authorize/buyAuthorize";

// 16-byte UUID → byte array for the on-chain offer_id (vector<u8>).
function uuidToBytes(uuid: string): number[] {
  const hex = uuid.replace(/-/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
  }
  return bytes;
}

// Build + sign + execute the Sui `arcpay::buy::buy` call. The backend authorizes
// the purchase by signing the (buyer, seller, offer_id, amounts, expiry) tuple;
// the Move contract rebuilds that message and verifies the ed25519 signature, so
// the client only forwards the args + signature (no message reconstruction).
//
// We BUILD and EXECUTE against our own testnet SuiClient and only use the wallet
// to SIGN. Phantom reports its chain as mainnet (even in testnet mode), so
// letting it build/execute would target the wrong network where the package
// doesn't exist; controlling both ends here pins everything to testnet.
export async function buy(wallet: SuiWallet, offerId: string): Promise<string> {
  const auth = await getBuyAuth(offerId, wallet.address);
  const total = BigInt(auth.sellerAmount) + BigInt(auth.feeAmount);

  const tx = new Transaction();
  tx.setSender(wallet.address);
  // Carve the exact payment (seller_amount + fee_amount in MIST) out of the gas
  // coin; the contract asserts payment.value() == seller_amount + fee_amount.
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

  // Resolve the tx (gas coins, object refs) against testnet, then hand the
  // fully-built bytes to the wallet purely for the signature. Execute the exact
  // bytes the wallet returned so the signature always matches.
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
