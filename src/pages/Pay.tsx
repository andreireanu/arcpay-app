import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useDynamicContext, getAuthToken } from "@dynamic-labs/sdk-react-core";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
import { getOffer } from "../supabase/offers/offers";
import { submitCounterOffer } from "../supabase/offers/counterOffers";
import { cancelCounterOffer } from "../supabase/offers/cancelCounterOffer";
import { getCounterOfferByBuyer, watchCounterOfferStatuses, watchBuyerCounterOfferInsert } from "../supabase/offers/getCounterOffers";
import { registerBuyer } from "../supabase/buyers/buyers";
import { exchangeToken } from "../supabase/auth/exchangeToken";
import type { CounterOffer } from "../types/counterOffer";
import { buy } from "../solana/instructions/buy";
import type { Offer } from "../types/offer";
import s from "../styles/pay.module.css";

export default function Pay() {
  const { offerId } = useParams<{ offerId: string }>();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [counterOfferOpen, setCounterOfferOpen] = useState(false);
  const [counterPrice, setCounterPrice] = useState("");
  const [buying, setBuying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [activeCounterOffer, setActiveCounterOffer] =
    useState<CounterOffer | null>(null);
  const [counterOfferLoading, setCounterOfferLoading] = useState(false);

  const { connection } = useConnection();
  const { primaryWallet, setShowAuthFlow, user } = useDynamicContext();
  const connected = !!primaryWallet && isSolanaWallet(primaryWallet);
  const exchangingRef = useRef(false);

  useEffect(() => {
    if (!offerId) return;
    getOffer(offerId)
      .then(setOffer)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [offerId]);

  useEffect(() => {
    const token = getAuthToken();
    if (!user || !primaryWallet || !token || exchangingRef.current) {
      setCounterOfferLoading(false);
      return;
    }
    exchangingRef.current = true;
    setCounterOfferLoading(true);
    exchangeToken(token, primaryWallet.address, "buyer")
      .then(() => getCounterOfferByBuyer(offerId!, primaryWallet.address))
      .then(setActiveCounterOffer)
      .catch(console.error)
      .finally(() => {
        exchangingRef.current = false;
        setCounterOfferLoading(false);
      });
  }, [user, primaryWallet, offerId]);

  useEffect(() => {
    if (!activeCounterOffer) return
    return watchCounterOfferStatuses([activeCounterOffer.id], (_id, status) => {
      if (status === 'confirmed' || status === 'buyer_canceled' || status === 'seller_canceled') setActiveCounterOffer(null)
    })
  }, [activeCounterOffer])

  useEffect(() => {
    if (!submitted || activeCounterOffer || !offerId || !primaryWallet) return
    return watchBuyerCounterOfferInsert(offerId, primaryWallet.address, (counterOffer) => {
      setActiveCounterOffer(counterOffer)
      setSubmitted(false)
    })
  }, [submitted, activeCounterOffer, offerId, primaryWallet])

  async function handleBuy() {
    if (!connected || !primaryWallet || !offerId || buying) return;
    setBuying(true);
    const signer = await primaryWallet.getSigner();
    const anchorWallet = {
      publicKey: new PublicKey(primaryWallet.address),
      signTransaction: signer.signTransaction.bind(signer),
      signAllTransactions: signer.signAllTransactions.bind(signer),
    } as unknown as import("@solana/wallet-adapter-react").AnchorWallet;
    try {
      await buy(connection, anchorWallet, offerId);
      await registerBuyer(primaryWallet.address);
    } finally {
      setBuying(false);
    }
  }

  async function handleSubmitCounterOffer() {
    if (!offerId || !connected || !primaryWallet || !counterPrice || !offer)
      return;
    const lamports = Math.round(parseFloat(counterPrice) * 1_000_000_000);
    if (!lamports || lamports <= 0) return;
    if (lamports >= offer.price_lamports) return;
    setSubmitting(true);
    try {
      const signer = await primaryWallet.getSigner();
      const anchorWallet = {
        publicKey: new PublicKey(primaryWallet.address),
        signTransaction: signer.signTransaction.bind(signer),
        signAllTransactions: signer.signAllTransactions.bind(signer),
      } as unknown as import("@solana/wallet-adapter-react").AnchorWallet;
      await submitCounterOffer(connection, anchorWallet, offerId, lamports);
      await registerBuyer(primaryWallet.address);
      setSubmitted(true);
      setCounterOfferOpen(false);
      setCounterPrice("");
    } catch (err) {
      console.error("Failed to submit counter offer", err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelOffer() {
    if (!activeCounterOffer || !connected || !primaryWallet || canceling) return;
    setCanceling(true);
    try {
      const signer = await primaryWallet.getSigner();
      const anchorWallet = {
        publicKey: new PublicKey(primaryWallet.address),
        signTransaction: signer.signTransaction.bind(signer),
        signAllTransactions: signer.signAllTransactions.bind(signer),
      } as unknown as import("@solana/wallet-adapter-react").AnchorWallet;
      await cancelCounterOffer(connection, anchorWallet, activeCounterOffer.ephemeral_id, offer!.seller_wallet!);
      setActiveCounterOffer(null);
    } catch (err) {
      console.error("Failed to cancel offer", err);
    } finally {
      setCanceling(false);
    }
  }

  if (loading) {
    return (
      <div className={s.page}>
        <div className={s.card}>
          <div className={s.logoWrap}>
            <img src="/favicon.svg" alt="ArcPay" className={s.logo} />
          </div>
          <p className={s.statusMessage}>Loading…</p>
        </div>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className={s.page}>
        <div className={s.card}>
          <div className={s.logoWrap}>
            <img src="/favicon.svg" alt="ArcPay" className={s.logo} />
          </div>
          <p className={s.statusMessage}>Offer not found.</p>
        </div>
      </div>
    );
  }

  const priceSOL = (offer.price_lamports / 1_000_000_000).toFixed(4);
  const isAvailable = offer.status === "active";

  return (
    <>
      <div className={s.page}>
        <div className={s.card}>
          <div className={s.logoWrap}>
            <img src="/favicon.svg" alt="ArcPay" className={s.logo} />
          </div>

          <div className={s.info}>
            <h1 className={s.name}>{offer.name}</h1>
            <p className={s.price}>{priceSOL} SOL</p>
            {offer.description && (
              <p className={s.description}>{offer.description}</p>
            )}
          </div>

          {!isAvailable ? (
            <span
              className={`${s.unavailableBadge} ${offer.status === "paused"
                ? s.unavailablePaused
                : offer.status === "sold"
                  ? s.unavailableSold
                  : s.unavailableCanceled
                }`}
            >
              {offer.status === "paused"
                ? "Paused"
                : offer.status === "sold"
                  ? "Sold out"
                  : "Cancelled"}
            </span>
          ) : submitted ? (
            <p className={s.successMessage}>Counter offer submitted!</p>
          ) : (
            <div className={s.actions}>
              {connected ? (
                <button
                  className={s.buyButton}
                  onClick={handleBuy}
                  disabled={buying}
                >
                  {buying ? "Buying…" : "BUY"}
                </button>
              ) : (
                <button
                  className={s.connectButton}
                  onClick={() => setShowAuthFlow(true)}
                >
                  Connect wallet
                </button>
              )}

              {connected && !counterOfferLoading && activeCounterOffer && (
                <div className={s.activeOfferRow}>
                  <span className={s.activeOfferLabel}>
                    Your active offer made:
                  </span>
                  <span className={s.activeOfferAmount}>
                    {((activeCounterOffer.seller_amount + activeCounterOffer.fee_amount) / 1_000_000_000).toFixed(4)} SOL
                  </span>
                  <div className={s.activeOfferActions}>
                    <button
                      className={s.inlineActionText}
                      onClick={handleCancelOffer}
                      disabled={canceling}
                    >
                      {canceling ? "Canceling..." : "Cancel"}
                    </button>
                  </div>
                </div>
              )}

              {connected && !counterOfferLoading && !activeCounterOffer && (
                <>
                  <div className={s.counterOfferHint}>
                    <p className={s.counterOfferHintBold}>
                      Not ready to pay full price?
                    </p>
                    <p className={s.counterOfferHintText}>
                      You can submit an offer for this item at a price that
                      works for you.
                    </p>
                  </div>
                  <button
                    className={s.createOfferButton}
                    onClick={() => setCounterOfferOpen(true)}
                  >
                    Create offer
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {counterOfferOpen && (
        <div
          className={s.modalOverlay}
          onClick={() => setCounterOfferOpen(false)}
        >
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={s.modalTitle}>Create offer</h2>
            <p className={s.modalDescription}>
              Submit an offer below. This is not a purchase - your offer will be
              accepted automatically if it qualifies for an active discount, a
              future marketing discount campaign or reviewed manually by the
              merchant. You'll be notified before any payment is taken.
            </p>
            <button className={s.modalLearnMore} onClick={() => { }}>
              Learn more about offers
            </button>
            <div className={s.modalField}>
              <label className={s.modalLabel}>Offered price (SOL)</label>
              <input
                className={s.modalInput}
                type="number"
                step="0.0001"
                min="0"
                placeholder="0.00"
                value={counterPrice}
                onChange={(e) => setCounterPrice(e.target.value)}
              />
            </div>
            <div className={s.modalActions}>
              <button
                className={s.modalCancelButton}
                onClick={() => setCounterOfferOpen(false)}
              >
                Cancel
              </button>
              <button
                className={s.modalSubmitButton}
                disabled={
                  !counterPrice ||
                  parseFloat(counterPrice) <= 0 ||
                  (!!offer &&
                    Math.round(parseFloat(counterPrice) * 1_000_000_000) >=
                    offer.price_lamports) ||
                  submitting
                }
                onClick={handleSubmitCounterOffer}
              >
                {submitting ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
