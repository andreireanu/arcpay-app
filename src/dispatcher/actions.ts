import { isSuiWallet } from "@dynamic-labs/sui-core";
import { buy as suiBuy } from "../sui/instructions/buy";
import { buy as solanaBuy } from "../solana/instructions/buy";
import { submitOffer as suiOffer } from "../sui/instructions/offer";
import { submitOffer as solanaOffer } from "../solana/instructions/offer";
import { cancelOffer as suiCancelOffer } from "../sui/instructions/cancelOffer";
import { cancelOffer as solanaCancelOffer } from "../solana/instructions/cancelOffer";
import { sellerCancelOffer as suiSellerCancelOffer } from "../sui/instructions/sellerCancelOffer";
import { sellerCancelOffer as solanaSellerCancelOffer } from "../solana/instructions/sellerCancelOffer";
import { acceptCounter as suiAcceptCounter } from "../sui/instructions/acceptCounter";
import { acceptCounter as solanaAcceptCounter } from "../solana/instructions/acceptCounter";
import { toAnchorWallet } from "../solana/walletAdapter";
import type { Offer } from "../types/offer";
import type { CounterOffer } from "../types/counterOffer";

// Chain-agnostic offer actions. This is the single place that knows how each
// chain builds a transaction; pages just pass the connected wallet + offer and
// stay chain-unaware.
type Connection = Parameters<typeof solanaBuy>[0];
type DynamicWallet = Parameters<typeof isSuiWallet>[0];

export async function buyOffer(
  wallet: DynamicWallet,
  connection: Connection,
  offer: Offer,
): Promise<string> {
  if (offer.chain === "sui") {
    if (!isSuiWallet(wallet)) {
      throw new Error("Connect a Sui wallet to buy a Sui offer");
    }
    return suiBuy(wallet, offer.id);
  }
  return solanaBuy(connection, await toAnchorWallet(wallet), offer.id);
}

// Place a counter offer on the offer's chain.
export async function counterOffer(
  wallet: DynamicWallet,
  connection: Connection,
  offer: Offer,
  amountLamports: number,
): Promise<string> {
  if (offer.chain === "sui") {
    if (!isSuiWallet(wallet)) {
      throw new Error("Connect a Sui wallet to counter a Sui offer");
    }
    return suiOffer(wallet, offer.id, amountLamports);
  }
  return solanaOffer(
    connection,
    await toAnchorWallet(wallet),
    offer.id,
    amountLamports,
  );
}

// Buyer cancels their own counter offer on the offer's chain.
export async function cancelCounterOfferAction(
  wallet: DynamicWallet,
  connection: Connection,
  counterOffer: CounterOffer,
): Promise<string> {
  if (counterOffer.chain === "sui") {
    if (!isSuiWallet(wallet)) {
      throw new Error("Connect a Sui wallet to cancel a Sui offer");
    }
    if (!counterOffer.sui_object_id) {
      throw new Error("Counter offer is missing its on-chain object id");
    }
    return suiCancelOffer(wallet, counterOffer.sui_object_id);
  }
  return solanaCancelOffer(
    connection,
    await toAnchorWallet(wallet),
    counterOffer.ephemeral_id,
  );
}

// Seller consents to accept counter offers.
export async function acceptCounterOffers(
  wallet: DynamicWallet,
  connection: Connection,
  counterOfferIds: string[],
): Promise<string> {
  // No offer object here to read .chain from; the seller's connected wallet is
  // the chain signal (a Sui seller only accepts Sui counter offers).
  if (isSuiWallet(wallet)) {
    return suiAcceptCounter(wallet, counterOfferIds);
  }
  return solanaAcceptCounter(
    connection,
    await toAnchorWallet(wallet),
    counterOfferIds,
  );
}

// Seller cancels an offer on the offer's chain (refunds active counter offers
// via the webhook).
export async function cancelOfferAsSeller(
  wallet: DynamicWallet,
  connection: Connection,
  offer: Offer,
): Promise<string> {
  if (offer.chain === "sui") {
    if (!isSuiWallet(wallet)) {
      throw new Error("Connect a Sui wallet to cancel a Sui offer");
    }
    return suiSellerCancelOffer(wallet, offer.id);
  }
  return solanaSellerCancelOffer(connection, await toAnchorWallet(wallet), offer.id);
}
