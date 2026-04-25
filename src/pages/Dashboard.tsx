import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useAuth } from "../hooks/useAuth";
import { useRegister } from "../hooks/useRegister";
import { useCreateListing } from "../hooks/useCreateListing";
import { getProducts } from "../supabase/products/products";
import { getOffersByUser } from "../supabase/offers/offers";
import type { Product } from "../types/product";
import type { OfferDetail } from "../types/offerDetail";
import AddOfferModal from "../components/AddOfferModal";

export default function Dashboard() {
  const { session, signOutUser } = useAuth();
  const { register, registering, registered, connected } = useRegister();
  const { createListing, creating } = useCreateListing();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [offers, setOffers] = useState<OfferDetail[]>([]);
  const [offerModalOpen, setOfferModalOpen] = useState(false);

  useEffect(() => {
    getProducts().then(setProducts).catch(console.error);
  }, []);

  useEffect(() => {
    if (!registered || !session) return;
    getOffersByUser(session.user.id).then(setOffers).catch(console.error);
  }, [registered, session]);

  async function handleSignOut() {
    await signOutUser();
    navigate("/login");
  }

  async function handleRegister() {
    await register();
  }

  async function handleCreateOffer(name: string, description: string, priceLamports: number) {
    const result = await createListing(name, description, priceLamports);
    if (result) {
      setOffers((prev) => [...prev, { ...result.offer, status: 'active', qr_listings: result.listing }]);
      setOfferModalOpen(false);
    }
  }

  async function handleDownloadQr(qrUrl: string, offerName: string) {
    const response = await fetch(qrUrl);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
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

      <main className="px-6 py-8 max-w-5xl mx-auto">
        <section className="border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-950 p-6">
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
                {registered ? (
                  <div className="w-full py-2 px-4 rounded-lg bg-green-600 text-white text-sm font-medium text-center">
                    Registered
                  </div>
                ) : (
                  <button
                    onClick={handleRegister}
                    disabled={!connected || registering}
                    className="w-full py-2 px-4 rounded-lg bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                  >
                    {registering ? "Registering…" : "Register"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {registered && (
          <section className="border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-950 p-6 mt-6">
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
                No offers yet. Create one to generate a QR code buyers can scan to pay.
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
                    <span className={`self-start text-xs font-medium px-2 py-0.5 rounded-full ${
                      offer.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                      offer.status === 'paused' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                      offer.status === 'cancelled' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                      'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                    }`}>
                      {offer.status}
                    </span>
                    <div className="flex gap-2 mt-1">
                      <a
                        href={`/pay/${offer.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        View page
                      </a>
                      {offer.qr_listings?.qr_url && (
                        <button
                          onClick={() => handleDownloadQr(offer.qr_listings!.qr_url!, offer.name)}
                          className="flex-1 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
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
