import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { useAuth } from "../hooks/useAuth";
import { useRegister } from "../hooks/useRegister";
import { useCreateListing } from "../hooks/useCreateListing";
import { getProducts } from "../supabase/products/products";
import { getOffersByUser, watchOfferStatuses } from "../supabase/offers/offers";
import { pauseListing } from "../solana/instructions/pauseListing";
import { resumeListing } from "../solana/instructions/resumeListing";
import { cancelListing } from "../solana/instructions/cancelListing";
import type { Product } from "../types/product";
import type { OfferDetail } from "../types/offerDetail";
import AddOfferModal from "../components/AddOfferModal";

export default function Dashboard() {
  const { session, signOutUser } = useAuth();
  const {
    register,
    registering,
    registered,
    registeredWallet,
    walletMatch,
    connected,
  } = useRegister();
  const { createListing, creating } = useCreateListing();
  const anchorWallet = useAnchorWallet();
  const { connection } = useConnection();
  const [products, setProducts] = useState<Product[]>([]);
  const [offers, setOffers] = useState<OfferDetail[]>([]);
  const [togglingOffer, setTogglingOffer] = useState<string | null>(null);
  const [cancellingOffer, setCancellingOffer] = useState<string | null>(null);
  const [waitingOffer, setWaitingOffer] = useState<{ id: string; label: string; expectedStatus: string } | null>(null);
  const [offerModalOpen, setOfferModalOpen] = useState(false);

  useEffect(() => {
    getProducts().then(setProducts).catch(console.error);
  }, []);

  useEffect(() => {
    if (!registered || !walletMatch || !session) return;
    getOffersByUser(session.user.id).then(setOffers).catch(console.error);
  }, [registered, walletMatch, session]);

  const offerIds = offers.map((o) => o.id).join(",");
  useEffect(() => {
    if (!offerIds) return;
    return watchOfferStatuses(
      offerIds.split(","),
      (offerId, status) => {
        setOffers((prev) =>
          prev.map((o) => (o.id === offerId ? { ...o, status: status as typeof o.status } : o)),
        );
        setWaitingOffer((prev) => (prev?.id === offerId ? null : prev));
        setCancellingOffer((prev) => (prev === offerId ? null : prev));
      },
    );
  }, [offerIds]);

  async function handleSignOut() {
    await signOutUser();
    window.location.href = "/login";
  }

  async function handleCreateOffer(
    name: string,
    description: string,
    priceLamports: number,
  ) {
    const result = await createListing(name, description, priceLamports);
    if (result) {
      setOffers((prev) => [
        ...prev,
        { ...result.offer, status: "active", qr_listings: result.listing },
      ]);
      setOfferModalOpen(false);
    }
  }

  async function handleTogglePause(offer: OfferDetail) {
    if (!anchorWallet || !offer.qr_listings?.listing_pda) return;
    setTogglingOffer(offer.id);
    try {
      if (offer.status === "active") {
        await pauseListing(connection, anchorWallet, offer.qr_listings.listing_pda);
        setWaitingOffer({ id: offer.id, label: "Pausing…", expectedStatus: "paused" });
      } else if (offer.status === "paused") {
        await resumeListing(connection, anchorWallet, offer.qr_listings.listing_pda);
        setWaitingOffer({ id: offer.id, label: "Resuming…", expectedStatus: "active" });
      }
    } catch (err) {
      console.error("toggle pause failed", err);
    } finally {
      setTogglingOffer(null);
    }
  }

  async function handleCancel(offer: OfferDetail) {
    if (!anchorWallet || !offer.qr_listings?.listing_pda) return;
    setCancellingOffer(offer.id);
    try {
      await cancelListing(connection, anchorWallet, offer.qr_listings.listing_pda);
    } catch (err) {
      console.error("cancel failed", err);
      setCancellingOffer(null);
    }
  }

  async function handleDownloadQr(qrUrl: string, offerName: string) {
    const response = await fetch(qrUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${offerName}-qr.svg`;
    a.click();
    URL.revokeObjectURL(url);
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
        {/* Wallet banners — only relevant when the user has already registered */}
        {registered && !connected && (
          <div className="rounded-xl border border-yellow-200 bg-yellow-50 dark:border-yellow-800/40 dark:bg-yellow-900/20 px-5 py-4 text-sm text-yellow-800 dark:text-yellow-300">
            Connect wallet{" "}
            <span className="font-mono font-medium">{registeredWallet!}</span>{" "}
            to access your offers.
          </div>
        )}
        {registered && connected && !walletMatch && (
          <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-800/40 dark:bg-red-900/20 px-5 py-4 text-sm text-red-800 dark:text-red-300">
            Wrong wallet connected. Please connect wallet{" "}
            <span className="font-mono font-medium">{registeredWallet!}</span>{" "}
            to access your offers.
          </div>
        )}

        {/* Products — only shown when wallet is connected */}
        {!connected && !registered && (
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-5 py-4 text-sm text-gray-500 dark:text-gray-400">
            Connect your Phantom wallet to get started.
          </div>
        )}
        {connected && (!registered || walletMatch) && <section className="border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-950 p-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50 mb-5">
            Products
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => (
              <div
                key={product.id}
                className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col gap-3 hover:shadow-md transition-shadow"
              >
                {product.image_url && (
                  <div className="w-full aspect-video rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
                    <img
                      src={product.image_url}
                      alt={product.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-50 text-base">
                    {product.name}
                  </h3>
                  {product.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                      {product.description}
                    </p>
                  )}
                </div>
                {registered && walletMatch ? (
                  <div className="w-full py-2 px-4 rounded-lg bg-green-600 text-white text-sm font-medium text-center">
                    Registered
                  </div>
                ) : (
                  <button
                    onClick={() => register()}
                    disabled={!connected || registering}
                    className="w-full py-2 px-4 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                  >
                    {registering
                      ? "Registering…"
                      : connected
                        ? "Register"
                        : "Connect wallet to register"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>}

        {/* QR Offers — only when registered AND correct wallet is connected */}
        {registered && walletMatch && (
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
                    <div className="flex items-center gap-2">
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
                      {(offer.status === "active" || offer.status === "paused") && offer.qr_listings?.listing_pda && (
                        <>
                          <button
                            onClick={() => handleTogglePause(offer)}
                            disabled={togglingOffer === offer.id || (waitingOffer?.id === offer.id && offer.status !== waitingOffer.expectedStatus) || cancellingOffer === offer.id}
                            className="flex items-center gap-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            {offer.status === "active" ? (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5">
                                <rect x="3" y="2" width="3.5" height="12" rx="1" />
                                <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5">
                                <path d="M3 2.5a.5.5 0 0 1 .765-.424l10 5.5a.5.5 0 0 1 0 .848l-10 5.5A.5.5 0 0 1 3 13.5v-11z" />
                              </svg>
                            )}
                            <span className="text-xs">
                              {togglingOffer === offer.id
                                ? "Confirm in wallet…"
                                : waitingOffer?.id === offer.id && offer.status !== waitingOffer.expectedStatus
                                ? waitingOffer.label
                                : offer.status === "active"
                                ? "Pause offer"
                                : "Resume offer"}
                            </span>
                          </button>
                          <button
                            onClick={() => handleCancel(offer)}
                            disabled={cancellingOffer === offer.id || togglingOffer === offer.id}
                            className="flex items-center gap-1.5 text-red-400 hover:text-red-600 dark:hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-5 h-5">
                              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22z" />
                            </svg>
                            <span className="text-xs">
                              {cancellingOffer === offer.id ? "Cancelling…" : "Cancel offer"}
                            </span>
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
                      {offer.qr_listings?.qr_url && (
                        <button
                          onClick={() =>
                            handleDownloadQr(
                              offer.qr_listings!.qr_url!,
                              offer.name,
                            )
                          }
                          className="flex-1 py-1.5 text-xs rounded-lg border border-purple-600 text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors"
                        >
                          Download QR
                        </button>
                      )}
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
