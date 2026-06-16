import { isSuiWallet } from "@dynamic-labs/sui-core";
import { buy as solanaBuy } from "../solana/instructions/buy";
import { buy as suiBuy } from "../sui/instructions/buy";
import { acceptCounter } from "../solana/instructions/acceptCounter";
import { sellerCancelOffer } from "../solana/instructions/sellerCancelOffer";
import { toAnchorWallet } from "../solana/walletAdapter";
import { submitCounterOffer } from "../supabase/offers/counterOffers";
import { cancelCounterOffer } from "../supabase/offers/cancelCounterOffer";
import type { Offer } from "../types/offer";

// Chain-agnostic offer actions. This is the single place that knows how each
// chain builds a transaction; pages just pass the connected wallet + offer and
// stay chain-unaware. New chains (or the upcoming Sui counter-offer flow) slot
// in here as extra branches without touching callers.

// Derive the types we need from the modules we call, so this layer doesn't
// import @solana/web3.js directly (web3 stays inside src/solana).
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
  return submitCounterOffer(
    connection,
    await toAnchorWallet(wallet),
    offer.id,
    amountLamports,
  );
}

export async function cancelCounterOfferAction(
  wallet: DynamicWallet,
  connection: Connection,
  ephemeralId: string,
): Promise<string> {
  return cancelCounterOffer(connection, await toAnchorWallet(wallet), ephemeralId);
}

// Seller consents to accept counter offers.
export async function acceptCounterOffers(
  wallet: DynamicWallet,
  connection: Connection,
  counterOfferIds: string[],
): Promise<string> {
  return acceptCounter(connection, await toAnchorWallet(wallet), counterOfferIds);
}

// Seller cancels an offer on-chain (refunds active counter offers via the
// webhook).
export async function cancelOfferAsSeller(
  wallet: DynamicWallet,
  connection: Connection,
  offerId: string,
): Promise<string> {
  return sellerCancelOffer(connection, await toAnchorWallet(wallet), offerId);
}
