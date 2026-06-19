import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  getOffer,
  pauseOffer,
  resumeOffer,
  cancelOffer,
  watchOfferStatuses,
} from "../supabase/offers/offers";
import {
  getCounterOffersByOffer,
  hideCounterOffers,
  unhideCounterOffers,
  watchCounterOfferStatuses,
  watchNewCounterOffers,
} from "../supabase/offers/getCounterOffers";
import {
  getTransactionsBySeller,
  watchNewTransactions,
  watchSettledCounterOffers,
} from "../supabase/transactions/transactions";
import {
  acceptCounterOffers,
  cancelOfferAsSeller,
} from "../dispatcher/actions";
import type { Offer } from "../types/offer";
import type { CounterOffer } from "../types/counterOffer";
import type { Transaction } from "../types/transaction";
import CounterOffersList from "../components/CounterOffersList";
import TransactionsList from "../components/TransactionsList";
import AutoAcceptButton from "../components/AutoAcceptButton";
import AlertModal from "../components/AlertModal";
import SolIcon from "../assets/icons/SolIcon";
import SuiIcon from "../assets/icons/SuiIcon";
import DownloadIcon from "../assets/icons/DownloadIcon";
import PauseIcon from "../assets/icons/PauseIcon";
import PlayIcon from "../assets/icons/PlayIcon";
import CloseIcon from "../assets/icons/CloseIcon";
import EyeIcon from "../assets/icons/EyeIcon";
import s from "../styles/dashboard.module.css";

export default function OfferDetail() {
  const { offerId } = useParams<{ offerId: string }>();
  const navigate = useNavigate();
  const { primaryWallet } = useDynamicContext();
  const { connection } = useConnection();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [counterOffers, setCounterOffers] = useState<CounterOffer[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"counteroffers" | "transactions">(
    "counteroffers",
  );
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoaded, setTxLoaded] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelCountdown, setCancelCountdown] = useState(10);
  const [canceling, setCanceling] = useState(false);
  const acceptingRef = useRef(false);
  const cancelWasActiveRef = useRef(false);

  useEffect(() => {
    if (!offerId) return;
    getOffer(offerId)
      .then((o) => {
        if (!o || o.seller_wallet !== primaryWallet?.address) {
          navigate(`/pay/${offerId}`, { replace: true });
          return;
        }
        setOffer(o);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    getCounterOffersByOffer(offerId)
      .then(({ visible, hiddenIds }) => {
        setCounterOffers(visible);
        setHiddenIds(hiddenIds);
      })
      .catch(console.error);
  }, [offerId, primaryWallet?.address, navigate]);

  const counterOfferIdKey = counterOffers.map((co) => co.id).join(",");
  useEffect(() => {
    const ids = counterOfferIdKey ? counterOfferIdKey.split(",") : [];
    if (ids.length === 0) return;
    return watchCounterOfferStatuses(ids, (id, status) => {
      if (status === "buyer_canceled" || status === "seller_canceled") {
        setCounterOffers((prev) => prev.filter((co) => co.id !== id));
      } else {
        setCounterOffers((prev) =>
          prev.map((co) => (co.id === id ? { ...co, status } : co)),
        );
      }
    });
  }, [counterOfferIdKey]);

  useEffect(() => {
    if (!offerId) return;
    return watchOfferStatuses([offerId], (_id, update) => {
      setOffer((prev) => (prev ? { ...prev, ...update } : prev));
    });
  }, [offerId]);

  useEffect(() => {
    if (!offerId) return;
    return watchNewCounterOffers(offerId, (counterOffer) => {
      setCounterOffers((prev) => [counterOffer, ...prev]);
    });
  }, [offerId]);

  // Lazy-load this offer's transactions when the tab is first opened.
  useEffect(() => {
    if (activeTab !== "transactions" || txLoaded || !primaryWallet?.address || !offerId)
      return;
    getTransactionsBySeller(primaryWallet.address, 0, 50, offerId)
      .then(({ transactions }) => {
        setTransactions(transactions);
        setTxLoaded(true);
      })
      .catch(console.error);
  }, [activeTab, txLoaded, primaryWallet?.address, offerId]);

  // Live-append new direct buys and counter offers as they settle.
  useEffect(() => {
    if (!offerId) return;
    return watchNewTransactions(offerId, (row) => {
      setTransactions((prev) =>
        prev.some((t) => t.id === row.id)
          ? prev
          : [{ ...row, offer_name: offer?.name ?? "", source: "buy" as const }, ...prev],
      );
    });
  }, [offerId, offer?.name]);

  useEffect(() => {
    if (!offerId) return;
    return watchSettledCounterOffers(offerId, (row) => {
      setTransactions((prev) =>
        prev.some((t) => t.id === row.id)
          ? prev
          : [
              { ...row, offer_name: offer?.name ?? "", source: "counter_offer" as const },
              ...prev,
            ],
      );
    });
  }, [offerId, offer?.name]);

  async function handlePause() {
    if (!offer) return;
    setToggling(true);
    await pauseOffer(offer.id);
    setOffer((prev) => (prev ? { ...prev, status: "paused" } : prev));
    setToggling(false);
  }

  async function handleResume() {
    if (!offer) return;
    setToggling(true);
    await resumeOffer(offer.id);
    setOffer((prev) => (prev ? { ...prev, status: "active" } : prev));
    setToggling(false);
  }

  useEffect(() => {
    if (!cancelModalOpen || cancelCountdown <= 0) return;
    const timer = setTimeout(() => setCancelCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cancelModalOpen, cancelCountdown]);

  async function handleCancelClick() {
    if (!offer || toggling) return;
    cancelWasActiveRef.current = offer.status === "active";
    if (offer.status === "active") {
      setToggling(true);
      try {
        await pauseOffer(offer.id);
        setOffer((prev) => (prev ? { ...prev, status: "paused" } : prev));
      } catch (err) {
        console.error("Failed to pause offer", err);
        setToggling(false);
        return;
      }
      setToggling(false);
    }
    setCancelCountdown(10);
    setCancelModalOpen(true);
  }

  async function handleCancelDismiss() {
    if (canceling) return;
    if (cancelWasActiveRef.current && offer) {
      try {
        await resumeOffer(offer.id);
        setOffer((prev) => (prev ? { ...prev, status: "active" } : prev));
      } catch (err) {
        console.error("Failed to resume offer", err);
      }
    }
    setCancelModalOpen(false);
  }

  async function handleCancelConfirm() {
    if (!offer || canceling) return;
    setCanceling(true);
    try {
      const activeCounterOffers = counterOffers.filter(
        (co) => co.status === "active",
      );

      if (activeCounterOffers.length === 0) {
        // Nothing to refund — skip the on-chain tx and mark canceled off-chain.
        await cancelOffer(offer.id);
        setOffer((prev) => (prev ? { ...prev, status: "canceled" } : prev));
        setCancelModalOpen(false);
        return;
      }

      // Active counter offers exist — go on-chain so the webhook refunds them.
      if (!primaryWallet) return;
      await cancelOfferAsSeller(primaryWallet, connection, offer);
      setCancelModalOpen(false);
    } catch (err) {
      console.error("Failed to cancel offer", err);
      try {
        await resumeOffer(offer.id);
        setOffer((prev) => (prev ? { ...prev, status: "active" } : prev));
      } catch {
        /* best-effort resume; original cancel error already logged */
      }
    } finally {
      setCanceling(false);
    }
  }

  async function handleDownloadQr() {
    if (!offer) return;
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
          const x = Math.round((w - logoSize) / 2);
          const y = Math.round((h - logoSize) / 2);
          svg = svg.replace(
            "</svg>",
            `<image href="${logoData}" x="${x}" y="${y}" width="${logoSize}" height="${logoSize}"/></svg>`,
          );
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

  async function handleAccept(ids: string[]) {
    if (!primaryWallet || ids.length === 0) return;
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    setAccepting(true);
    try {
      await acceptCounterOffers(primaryWallet, connection, ids);
    } catch (err) {
      console.error("Accept counter offer failed", err);
      setAcceptError(
        err instanceof Error ? err.message : "Could not accept these offers.",
      );
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  }

  async function handleHide(ids: string[]) {
    if (ids.length === 0) return;
    try {
      await hideCounterOffers(ids);
      setCounterOffers((prev) => prev.filter((co) => !ids.includes(co.id)));
      setHiddenIds((prev) => [...prev, ...ids]);
    } catch (err) {
      console.error("Failed to hide counter offers", err);
    }
  }

  async function handleShowHidden() {
    if (!offerId || hiddenIds.length === 0) return;
    try {
      await unhideCounterOffers(hiddenIds);
      const { visible, hiddenIds: hi } = await getCounterOffersByOffer(offerId);
      setCounterOffers(visible);
      setHiddenIds(hi);
    } catch (err) {
      console.error("Failed to show hidden counter offers", err);
    }
  }

  function statusClass(status: Offer["status"]) {
    if (status === "active") return s.statusActive;
    if (status === "paused") return s.statusPaused;
    if (status === "canceled") return s.statusCanceled;
    if (status === "sold") return s.statusSold;
    return "";
  }

  if (loading) {
    return (
      <div className={s.page}>
        <header className={s.header}>
          <div className={s.logo}>
            <img src="/favicon.svg" alt="" className={s.logoIcon} />
            <span className={s.logoWordmark}>arcpay</span>
          </div>
        </header>
        <main className={s.content}>
          <p className={s.offersEmpty}>Loading…</p>
        </main>
      </div>
    );
  }

  if (!offer) {
    return (
      <div className={s.page}>
        <header className={s.header}>
          <div className={s.logo}>
            <img src="/favicon.svg" alt="" className={s.logoIcon} />
            <span className={s.logoWordmark}>arcpay</span>
          </div>
        </header>
        <main className={s.content}>
          <p className={s.offersEmpty}>Offer not found.</p>
        </main>
      </div>
    );
  }

  const isSui = offer.chain === "sui";
  const price = (offer.price_lamports / 1_000_000_000).toFixed(4);
  const canAct = offer.status === "active" || offer.status === "paused";

  return (
    <>
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.logo}>
          <img src="/favicon.svg" alt="" className={s.logoIcon} />
          <span className={s.logoWordmark}>arcpay</span>
        </div>
        <button
          className={s.signOutButton}
          onClick={() => navigate("/seller")}
        >
          ← Back
        </button>
      </header>

      <main className={s.content}>
        <div className={s.offersSection}>
          <div className={s.offerDetailMain}>
            <div className={s.offerDetailThumb}>
              <img src="/favicon.svg" alt="" />
            </div>
            <div className={s.offerDetailContent}>
              <div className={s.offerDetailNameRow}>
                <h1 className={s.offerDetailName}>{offer.name}</h1>
                <div className={s.offerDetailStatusGroup}>
                  <AutoAcceptButton offer={offer} />
                  <span className={`${s.statusBadge} ${statusClass(offer.status)}`}>
                    {offer.status}
                  </span>
                </div>
              </div>
              {offer.description && (
                <p className={s.offerDetailDescription}>{offer.description}</p>
              )}
              <div className={s.offerDetailPrice}>
                {isSui ? <SuiIcon size={30} /> : <SolIcon size={30} />}
                <span>{price} {isSui ? "SUI" : "SOL"}</span>
              </div>

              <div className={s.offerDetailActions}>
                <span className={s.offerDetailQuantity}>
                  {offer.unlimited
                    ? 'Unlimited'
                    : `${offer.quantity - offer.quantity_sold} of ${offer.quantity} remaining`}
                </span>
                <a
                  href={`/pay/${offer.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={s.offerDetailBtn}
                >
                  <EyeIcon />
                  View Page
                </a>
                <button className={s.offerDetailBtn} onClick={handleDownloadQr}>
                  <DownloadIcon size={14} />
                  Download QR
                </button>
                {canAct && (
                  <button
                    className={s.offerDetailBtn}
                    disabled={toggling}
                    onClick={() =>
                      offer.status === "active" ? handlePause() : handleResume()
                    }
                  >
                    {offer.status === "active" ? <PauseIcon /> : <PlayIcon />}
                    {toggling
                      ? offer.status === "active"
                        ? "Pausing…"
                        : "Resuming…"
                      : offer.status === "active"
                        ? "Pause"
                        : "Resume"}
                  </button>
                )}
                {canAct && (
                  <button
                    className={s.offerDetailBtn}
                    onClick={handleCancelClick}
                    disabled={toggling}
                  >
                    <CloseIcon />
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <section className={s.bottomPanel}>
          <div className={s.tabsRow}>
            <div className={s.tabGroup}>
              <button
                className={`${s.tabBtn} ${activeTab === "counteroffers" ? s.tabBtnActive : ""}`}
                onClick={() => setActiveTab("counteroffers")}
              >
                {counterOffers.length > 0 && (
                  <span className={s.tabBadge}>{counterOffers.length}</span>
                )}
                Active offers
              </button>
              <button
                className={`${s.tabBtn} ${activeTab === "transactions" ? s.tabBtnActive : ""}`}
                onClick={() => setActiveTab("transactions")}
              >
                Transactions
              </button>
            </div>
            {activeTab === "counteroffers" && hiddenIds.length > 0 && (
              <button className={s.unhideAllBtn} onClick={handleShowHidden}>
                Show hidden ({hiddenIds.length})
              </button>
            )}
          </div>

          {activeTab === "counteroffers" &&
            (counterOffers.length === 0 ? (
              <p className={s.offersEmpty}>No active counter offers.</p>
            ) : (
              <CounterOffersList
                counterOffers={counterOffers}
                accepting={accepting}
                onAccept={handleAccept}
                onHide={handleHide}
                offerNameFor={() => offer.name}
              />
            ))}

          {activeTab === "transactions" && (
            <TransactionsList transactions={transactions} loading={!txLoaded} />
          )}
        </section>
      </main>
    </div>

    <AlertModal
      message={acceptError}
      onClose={() => setAcceptError(null)}
      title="Can't accept"
    />

    {cancelModalOpen && (
        <div className={s.modalOverlay} onClick={handleCancelDismiss}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={s.modalTitle}>Cancel offer?</h2>
            <p>All active counter offers will be automatically refunded to buyers. This cannot be undone.</p>
            <div className={s.modalActions}>
              <button
                className={s.modalCancelButton}
                onClick={handleCancelDismiss}
                disabled={canceling}
              >
                Keep offer
              </button>
              <button
                className={s.modalSubmitButton}
                disabled={cancelCountdown > 0 || canceling}
                onClick={handleCancelConfirm}
              >
                {canceling
                  ? "Canceling…"
                  : cancelCountdown > 0
                    ? `Confirm (${cancelCountdown})`
                    : "Confirm"}
              </button>
            </div>
          </div>
        </div>
    )}
    </>
  );
}
