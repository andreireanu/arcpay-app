import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getOffer } from "../supabase/offers/offers";
import type { OfferDetail } from "../types/offerDetail";

const statusConfig = {
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
  cancelled: {
    label: "Cancelled",
    className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  unlisted: {
    label: "Pending",
    className: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  },
};

export default function Pay() {
  const { offerId } = useParams<{ offerId: string }>();
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!offerId) return;
    getOffer(offerId)
      .then(setOffer)
      .catch(console.error)
      .finally(() => setLoading(false));
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

  const listing = offer.qr_listings;
  const priceSOL = (offer.price_lamports / 1_000_000_000).toFixed(4);
  const { label: statusLabel, className: statusClass } =
    statusConfig[offer.status];
  const canBuy = offer.status === "active" && listing;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Image */}
        <div className="w-full aspect-square rounded-t-2xl bg-gray-100 dark:bg-gray-800" />

        {/* Card */}
        <div className="bg-white dark:bg-gray-950 rounded-b-2xl border border-t-0 border-gray-200 dark:border-gray-700 px-5 py-6 flex flex-col gap-4">
          {/* Title */}
          <div>
            <h1 className="text-xl font-bold text-purple-600 uppercase leading-tight tracking-tight">
              {offer.name}
            </h1>
            <p className="text-xl font-bold text-gray-900 dark:text-gray-50 mt-2">
              {priceSOL} <span className="text-base font-semibold">SOL</span>
            </p>
          </div>

          {/* Description */}
          {offer.description && (
            <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
              {offer.description}
            </p>
          )}

          {/* Status — only show if not active */}
          {offer.status !== 'active' && (
            <span className={`self-start text-xs font-medium px-2 py-0.5 rounded-full ${statusClass}`}>
              {statusLabel}
            </span>
          )}

          {/* Action */}
          {canBuy ? (
            <button className="w-full py-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold transition-colors mt-1">
              Buy
            </button>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 py-2">
              {offer.status === 'unlisted' || !listing
                ? 'This listing is not yet confirmed on-chain.'
                : `This listing is currently ${offer.status}.`}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
