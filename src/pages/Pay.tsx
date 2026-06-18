import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useConnection } from "@solana/wallet-adapter-react";
import { useDynamicContext, getAuthToken } from "@dynamic-labs/sdk-react-core";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
import { isSuiWallet } from "@dynamic-labs/sui-core";
import { getOffer } from "../supabase/offers/offers";
import {
  getCounterOfferByBuyer,
  watchCounterOfferStatuses,
  watchBuyerCounterOfferInsert,
} from "../supabase/offers/getCounterOffers";
import { registerBuyer } from "../supabase/buyers/buyers";
import { exchangeToken } from "../supabase/auth/exchangeToken";
import type { CounterOffer } from "../types/counterOffer";
import {
  buyOffer,
  counterOffer,
  cancelCounterOfferAction,
} from "../dispatcher/actions";
import type { Offer } from "../types/offer";
import { config } from "../config/env";
import InfoIcon from "../assets/icons/InfoIcon";
import s from "../styles/pay.module.css";

const RETURNABLE_FEE_LAMPORTS = config.arcPay.returnableFeeLamports;
const TX_COST_LAMPORTS = config.arcPay.txCostLamports;

function formatSol(lamports: number): string {
  return (lamports / 1_000_000_000).toLocaleString("en-US", {
    maximumFractionDigits: 9,
  });
}

export default function Pay() {
  const { offerId } = useParams<{ offerId: string }>();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [counterOfferOpen, setCounterOfferOpen] = useState(false);
  const [counterPrice, setCounterPrice] = useState("");
  const [buying, setBuying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [counterError, setCounterError] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [activeCounterOffer, setActiveCounterOffer] =
    useState<CounterOffer | null>(null);
  const [counterOfferLoading, setCounterOfferLoading] = useState(false);

  const { connection } = useConnection();
  const { primaryWallet, setShowAuthFlow, user } = useDynamicContext();
  // The buyer must be connected on the offer's chain: a Sui offer needs a Sui
  // wallet, a Solana offer a Solana wallet. (Defaults to Solana until the offer
  // loads.)
  const connected =
    !!primaryWallet &&
    (offer?.chain === "sui"
      ? isSuiWallet(primaryWallet)
      : isSolanaWallet(primaryWallet));
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
    if (!activeCounterOffer) return;
    return watchCounterOfferStatuses([activeCounterOffer.id], (_id, status) => {
      if (
        status === "confirmed" ||
        status === "buyer_canceled" ||
        status === "seller_canceled"
      )
        setActiveCounterOffer(null);
    });
  }, [activeCounterOffer]);

  useEffect(() => {
    if (!submitted || activeCounterOffer || !offerId || !primaryWallet) return;
    const unsubscribe = watchBuyerCounterOfferInsert(
      offerId,
      primaryWallet.address,
      (counterOffer) => {
        setActiveCounterOffer(counterOffer);
        setSubmitted(false);
      },
    );
    // Polling fallback: the webhook can insert the row before the realtime
    // channel finishes joining, and postgres_changes does not replay missed
    // events — without this the page can wait forever on a row that already
    // exists. The poll stops as soon as the row is found (effect re-runs).
    let attempts = 0;
    const poll = setInterval(async () => {
      if (++attempts > 30) {
        clearInterval(poll);
        return;
      }
      try {
        const co = await getCounterOfferByBuyer(offerId, primaryWallet.address);
        if (co) {
          setActiveCounterOffer(co);
          setSubmitted(false);
        }
      } catch (err) {
        console.error("counter offer poll failed", err);
      }
    }, 2000);
    return () => {
      unsubscribe();
      clearInterval(poll);
    };
  }, [submitted, activeCounterOffer, offerId, primaryWallet]);

  async function handleBuy() {
    if (!connected || !primaryWallet || !offerId || buying || !offer) return;
    setBuying(true);
    try {
      await buyOffer(primaryWallet, connection, offer);
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
    setCounterError(null);
    try {
      await counterOffer(primaryWallet, connection, offer, lamports);
      await registerBuyer(primaryWallet.address);
      setSubmitted(true);
      setCounterOfferOpen(false);
      setCounterPrice("");
    } catch (err) {
      console.error("Failed to submit counter offer", err);
      const message = err instanceof Error ? err.message : String(err);
      if (/InsufficientCoinBalance|insufficient/i.test(message)) {
        setCounterError(
          `Not enough ${currency} in your wallet to cover the offer plus network fees.`,
        );
      } else {
        setCounterError("Could not submit your offer. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelOffer() {
    if (!activeCounterOffer || !connected || !primaryWallet || canceling)
      return;
    setCanceling(true);
    try {
      await cancelCounterOfferAction(
        primaryWallet,
        connection,
        activeCounterOffer,
      );
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

  // Both chains use 9 decimals (lamports / MIST); only the token label differs.
  const isSui = offer.chain === "sui";
  const currency = isSui ? "SUI" : "SOL";
  const priceAmount = (offer.price_lamports / 1_000_000_000).toFixed(4);
  const isAvailable = offer.status === "active";

  const offeredLamports = Math.max(
    0,
    Math.round((parseFloat(counterPrice) || 0) * 1_000_000_000),
  );
  const feesAppliedLamports = Math.floor(
    (offeredLamports * offer.fee_bps) / 10000,
  );
  // The returnable fee is Solana Offer-PDA rent; Sui has no equivalent buyer deposit.
  const totalChargedLamports =
    offeredLamports +
    (isSui ? 0 : RETURNABLE_FEE_LAMPORTS) +
    TX_COST_LAMPORTS;

  return (
    <>
      <div className={s.page}>
        <div className={s.card}>
          <div className={s.logoWrap}>
            <img src="/favicon.svg" alt="ArcPay" className={s.logo} />
          </div>

          <div className={s.info}>
            <h1 className={s.name}>{offer.name}</h1>
            <p className={s.price}>{priceAmount} {currency}</p>
            {offer.description && (
              <p className={s.description}>{offer.description}</p>
            )}
          </div>

          {!isAvailable ? (
            <span
              className={`${s.unavailableBadge} ${
                offer.status === "paused"
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
            <p className={s.successMessage}>Offer submitted!</p>
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
                    {(
                      (activeCounterOffer.seller_amount +
                        activeCounterOffer.fee_amount) /
                      1_000_000_000
                    ).toFixed(4)}{" "}
                    {currency}
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
          onClick={() => {
            setCounterOfferOpen(false);
            setCounterError(null);
          }}
        >
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={s.modalTitle}>Create offer</h2>
            <p className={s.modalDescription}>
              Submit an offer below. This is not a purchase - your offer will be
              accepted automatically if it qualifies for an active discount, a
              future marketing discount campaign or reviewed manually by the
              merchant. You'll be notified before any payment is taken.
            </p>
            <button className={s.modalLearnMore} onClick={() => {}}>
              Learn more about offers
            </button>
            <div className={s.modalField}>
              <label className={s.modalLabel}>Offered price ({currency})</label>
              <input
                className={s.modalInput}
                type="number"
                step="0.0001"
                min="0"
                placeholder="0.00"
                value={counterPrice}
                onChange={(e) => {
                  setCounterPrice(e.target.value);
                  setCounterError(null);
                }}
              />
            </div>
            <div className={s.feeBreakdown}>
              <div className={s.feeRow}>
                <span className={s.feeLabel}>Fees applied</span>
                <span className={s.feeValue}>
                  {formatSol(feesAppliedLamports)} {currency}
                </span>
              </div>
              {!isSui && (
                <div className={s.feeRow}>
                  <span className={s.feeLabel}>
                    Returnable fee
                    <span className={s.feeTooltipWrap} tabIndex={0}>
                      <InfoIcon className={s.feeInfoIcon} />
                      <span className={s.feeTooltip} role="tooltip">
                        This fee will be returned when the offer is settled, no
                        matter the outcome
                      </span>
                    </span>
                  </span>
                  <span className={s.returnableValue}>
                    ± {formatSol(RETURNABLE_FEE_LAMPORTS)} {currency}
                  </span>
                </div>
              )}
              <div className={s.feeRow}>
                <span className={s.feeLabel}>Total amount charged</span>
                <span className={s.feeValue}>
                  ± {formatSol(totalChargedLamports)} {currency}
                </span>
              </div>
            </div>
            {counterError && (
              <p className={s.errorMessage}>{counterError}</p>
            )}
            <div className={s.modalActions}>
              <button
                className={s.modalCancelButton}
                onClick={() => {
                  setCounterOfferOpen(false);
                  setCounterError(null);
                }}
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
