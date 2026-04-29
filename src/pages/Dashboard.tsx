import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useAnchorWallet } from "@solana/wallet-adapter-react";
import QRCode from "qrcode";
import { useAuth } from "../hooks/useAuth";
import { useRegister } from "../hooks/useRegister";
import { useCreateListing } from "../hooks/useCreateListing";
import {
  getOffersByWallet,
  pauseOffer,
  resumeOffer,
  cancelOffer,
  watchOfferStatuses,
} from "../supabase/offers/offers";
import type { Offer } from "../types/offer";
import AddOfferModal from "../components/AddOfferModal";

export default function Dashboard() {
  const { session, signOutUser } = useAuth();
  const { register, registering, registered, error: registerError } = useRegister();
  const { createListing, creating } = useCreateListing();
  const anchorWallet = useAnchorWallet();
  const walletAddress = anchorWallet?.publicKey?.toBase58();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [togglingOffer, setTogglingOffer] = useState<{ id: string; label: string } | null>(null);

  useEffect(() => {
    if (!registered || !walletAddress) return;
    getOffersByWallet(walletAddress).then(setOffers).catch(console.error);
  }, [registered, walletAddress]);

  const offerIds = offers.map((o) => o.id);
  useEffect(() => {
    if (offerIds.length === 0) return;
    return watchOfferStatuses(offerIds, (offerId, status) => {
      setOffers((prev) =>
        prev.map((o) =>
          o.id === offerId ? { ...o, status: status as Offer["status"] } : o,
        ),
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerIds.join(",")]);

  async function handleSignOut() {
    await signOutUser();
    window.location.href = "/login";
  }

  async function handleCreateOffer(
    name: string,
    description: string,
    priceLamports: number,
  ) {
    const offer = await createListing(name, description, priceLamports);
    if (offer) {
      setOffers((prev) => [offer, ...prev]);
      setOfferModalOpen(false);
    }
  }

  async function handlePause(offer: Offer) {
    setTogglingOffer({ id: offer.id, label: "Pausing…" });
    await pauseOffer(offer.id);
    setOffers((prev) =>
      prev.map((o) => (o.id === offer.id ? { ...o, status: "paused" } : o)),
    );
    setTogglingOffer(null);
  }

  async function handleResume(offer: Offer) {
    setTogglingOffer({ id: offer.id, label: "Resuming…" });
    await resumeOffer(offer.id);
    setOffers((prev) =>
      prev.map((o) => (o.id === offer.id ? { ...o, status: "active" } : o)),
    );
    setTogglingOffer(null);
  }

  async function handleCancel(offer: Offer) {
    await cancelOffer(offer.id);
    setOffers((prev) =>
      prev.map((o) => (o.id === offer.id ? { ...o, status: "canceled" } : o)),
    );
  }

  async function handleDownloadQr(offer: Offer) {
    const url = `${window.location.origin}/pay/${offer.id}`;
    let svg: string = await QRCode.toString(url, {
      type: "svg",
      errorCorrectionLevel: "H",
    });

    try {
      const resp = await fetch("/favicon.svg");
      if (resp.ok) {
        const b64 = btoa(await resp.text());
        const logoData = `data:image/svg+xml;base64,${b64}`;
        const match = svg.match(
          /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/,
        );
        if (match) {
          const w = parseFloat(match[1]);
          const h = parseFloat(match[2]);
          const logoSize = Math.round(w * 0.22);
          const pad = 3;
          const x = Math.round((w - logoSize) / 2);
          const y = Math.round((h - logoSize) / 2);
          const overlay = [
            `<rect x="${x - pad}" y="${y - pad}" width="${logoSize + pad * 2}" height="${logoSize + pad * 2}" fill="white" rx="${pad}"/>`,
            `<image href="${logoData}" x="${x}" y="${y}" width="${logoSize}" height="${logoSize}"/>`,
          ].join("");
          svg = svg.replace("</svg>", `${overlay}</svg>`);
        }
      }
    } catch {
      /* download without logo if fetch fails */
    }

    const blob = new Blob([svg], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${offer.name}-qr.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-50 m-0">
            Dashboard
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {session?.user.email}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <WalletMultiButton />
          <button
            onClick={handleSignOut}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="px-6 py-8 max-w-5xl mx-auto flex flex-col gap-6">
        {/* No wallet connected */}
        {!anchorWallet && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
            Connect your wallet to get started.
          </div>
        )}

        {/* Wallet connected but pending verification */}
        {anchorWallet && !registered && (
          <div className="rounded-xl border border-purple-200 bg-purple-50 dark:border-purple-800/40 dark:bg-purple-900/20 px-5 py-4 text-sm text-purple-800 dark:text-purple-300 flex items-center justify-between gap-4">
            <span>
              {registering
                ? "Sign the message in your wallet to verify ownership…"
                : registerError
                  ? `Wallet verification failed: ${registerError}`
                  : "Verifying wallet…"}
            </span>
            {registerError && !registering && (
              <button
                onClick={register}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-medium transition-colors"
              >
                Try again
              </button>
            )}
          </div>
        )}

        {/* QR Offers — shown once wallet is verified */}
        {registered && (
          <section className="border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-950 p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                QR Offers
              </h2>
              <button
                onClick={() => setOfferModalOpen(true)}
                className="px-4 py-2 text-sm rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors"
              >
                Create
              </button>
            </div>

            {offers.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No offers yet. Create one to generate a QR code buyers can scan
                to pay.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {offers.map((offer) => (
                  <div
                    key={offer.id}
                    className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col gap-2"
                  >
                    <h3 className="font-semibold text-gray-900 dark:text-gray-50 text-base">
                      {offer.name}
                    </h3>
                    {offer.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {offer.description}
                      </p>
                    )}
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {(offer.price_lamports / 1_000_000_000).toFixed(4)} SOL
                    </p>

                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          offer.status === "active"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            : offer.status === "paused"
                              ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                              : offer.status === "canceled"
                                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                : offer.status === "sold"
                                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
                        }`}
                      >
                        {offer.status}
                      </span>

                      {(offer.status === "active" ||
                        offer.status === "paused") && (
                        <>
                          <button
                            onClick={() =>
                              offer.status === "active"
                                ? handlePause(offer)
                                : handleResume(offer)
                            }
                            disabled={togglingOffer?.id === offer.id}
                            className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {togglingOffer?.id === offer.id ? null : offer.status === "active" ? (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                                className="w-5 h-5"
                              >
                                <rect
                                  x="3"
                                  y="2"
                                  width="3.5"
                                  height="12"
                                  rx="1"
                                />
                                <rect
                                  x="9.5"
                                  y="2"
                                  width="3.5"
                                  height="12"
                                  rx="1"
                                />
                              </svg>
                            ) : (
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                                className="w-5 h-5"
                              >
                                <path d="M3 2.5a.5.5 0 0 1 .765-.424l10 5.5a.5.5 0 0 1 0 .848l-10 5.5A.5.5 0 0 1 3 13.5v-11z" />
                              </svg>
                            )}
                            <span className="text-xs">
                              {togglingOffer?.id === offer.id
                                ? togglingOffer.label
                                : offer.status === "active" ? "Pause" : "Resume"}
                            </span>
                          </button>

                          <button
                            onClick={() => handleCancel(offer)}
                            className="flex items-center gap-1.5 text-red-400 hover:text-red-600 transition-colors"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              viewBox="0 0 16 16"
                              fill="currentColor"
                              className="w-5 h-5"
                            >
                              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22z" />
                            </svg>
                            <span className="text-xs">Cancel</span>
                          </button>
                        </>
                      )}
                    </div>

                    <div className="flex gap-2 mt-1">
                      <a
                        href={`/pay/${offer.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center py-1.5 text-xs rounded-lg border border-purple-600 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
                      >
                        View page
                      </a>
                      <button
                        onClick={() => handleDownloadQr(offer)}
                        className="flex-1 py-1.5 text-xs rounded-lg border border-purple-600 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
                      >
                        Download QR
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      <AddOfferModal
        open={offerModalOpen}
        onClose={() => setOfferModalOpen(false)}
        onSubmit={handleCreateOffer}
        creating={creating}
      />
    </div>
  );
}
