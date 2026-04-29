import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  useAnchorWallet,
  useConnection,
  useWallet,
} from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { getOffer, watchOfferStatus } from "../supabase/offers/offers";
import { buy } from "../solana/instructions/buy";
import type { Offer } from "../types/offer";

const statusConfig: Record<string, { label: string; className: string }> = {
  active: {
    label: "Active",
    className:
      "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  paused: {
    label: "Paused",
    className:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  canceled: {
    label: "Canceled",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  sold: {
    label: "Sold",
    className:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
};

export default function Pay() {
  const { offerId } = useParams<{ offerId: string }>();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [bought, setBought] = useState(false);
  const [waitingConfirmation, setWaitingConfirmation] = useState(false);
  const waitingConfirmationRef = useRef(false);
  const [buyError, setBuyError] = useState<string | null>(null);

  const anchorWallet = useAnchorWallet();
  const { connected } = useWallet();
  const { connection } = useConnection();

  useEffect(() => {
    if (!offerId) return;
    getOffer(offerId)
      .then(setOffer)
      .catch(console.error)
      .finally(() => setLoading(false));

    const unsubscribe = watchOfferStatus(offerId, (status) => {
      setOffer((prev) =>
        prev ? { ...prev, status: status as Offer["status"] } : prev,
      );
      if (status === "sold" && waitingConfirmationRef.current) {
        waitingConfirmationRef.current = false;
        setWaitingConfirmation(false);
        setBought(true);
      }
    });
    return unsubscribe;
  }, [offerId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="text-sm text-gray-400">Offer not found.</p>
      </div>
    );
  }

  const priceSOL = (offer.price_lamports / 1_000_000_000).toFixed(4);
  const { label: statusLabel, className: statusClass } = statusConfig[offer.status] ?? {
    label: offer.status,
    className: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  };
  const canBuy = offer.status === "active" && !bought;

  async function handleBuy() {
    if (!anchorWallet || !connected || !offerId) return;
    setBuyError(null);
    setBuying(true);
    try {
      await buy(connection, anchorWallet, offerId);
      waitingConfirmationRef.current = true;
      setWaitingConfirmation(true);
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : "Transaction failed");
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="w-full aspect-square rounded-t-2xl bg-gray-100 dark:bg-gray-800" />

        <div className="bg-white dark:bg-gray-950 rounded-b-2xl border border-t-0 border-gray-200 dark:border-gray-700 px-5 py-6 flex flex-col gap-4">
          <div>
            <h1 className="text-xl font-bold text-purple-600 uppercase leading-tight tracking-tight">
              {offer.name}
            </h1>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-2">
              {priceSOL} <span className="text-base font-semibold">SOL</span>
            </p>
          </div>

          {offer.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              {offer.description}
            </p>
          )}

          {offer.status !== "active" && (
            <span className={`self-start text-xs font-medium px-2 py-0.5 rounded-full ${statusClass}`}>
              {statusLabel}
            </span>
          )}

          {bought ? (
            <p className="text-sm text-green-600 dark:text-green-400 font-medium py-2">
              Payment sent!
            </p>
          ) : waitingConfirmation ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium py-2">
              Transaction sent, waiting for on-chain confirmation…
            </p>
          ) : canBuy ? (
            <>
              {connected ? (
                <button
                  onClick={handleBuy}
                  disabled={buying}
                  className="w-full py-3 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors mt-1"
                >
                  {buying ? "Confirm in wallet…" : "Buy"}
                </button>
              ) : (
                <WalletMultiButton style={{ width: "100%", justifyContent: "center" }} />
              )}
              {buyError && (
                <p className="text-xs text-red-500 mt-1">{buyError}</p>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 py-2">
              {offer.status === "sold"
                ? "This item has already been sold."
                : `This listing is currently ${offer.status}.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
