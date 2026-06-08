import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  getOffer,
  pauseOffer,
  resumeOffer,
  cancelOffer,
  watchOfferStatuses,
} from "../supabase/offers/offers";
import {
  getCounterOffersByOffer,
  watchCounterOfferStatuses,
  watchNewCounterOffers,
} from "../supabase/offers/getCounterOffers";
import { acceptCounter } from "../solana/instructions/acceptCounter";
import { sellerCancelOffer } from "../solana/instructions/sellerCancelOffer";
import type { Offer } from "../types/offer";
import type { CounterOffer } from "../types/counterOffer";
import s from "../styles/dashboard.module.css";

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 3l14 9-14 9V3z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

export default function OfferDetail() {
  const { offerId } = useParams<{ offerId: string }>();
  const navigate = useNavigate();
  const { primaryWallet } = useDynamicContext();
  const { connection } = useConnection();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [counterOffers, setCounterOffers] = useState<CounterOffer[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [accepting, setAccepting] = useState(false);
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
      .then(setCounterOffers)
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
      if (!primaryWallet || !isSolanaWallet(primaryWallet)) return;
      const signer = await primaryWallet.getSigner();
      const anchorWallet = {
        publicKey: new PublicKey(primaryWallet.address),
        signTransaction: signer.signTransaction.bind(signer),
        signAllTransactions: signer.signAllTransactions.bind(signer),
      } as unknown as import("@solana/wallet-adapter-react").AnchorWallet;
      await sellerCancelOffer(connection, anchorWallet, offer.id);
      setCancelModalOpen(false);
    } catch (err) {
      console.error("Failed to cancel offer", err);
      try {
        await resumeOffer(offer.id);
        setOffer((prev) => (prev ? { ...prev, status: "active" } : prev));
      } catch {}
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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAccept(ids: string[]) {
    if (!primaryWallet || !isSolanaWallet(primaryWallet) || ids.length === 0)
      return;
    if (acceptingRef.current) return;
    acceptingRef.current = true;
    setAccepting(true);
    try {
      const signer = await primaryWallet.getSigner();
      const anchorWallet = {
        publicKey: new PublicKey(primaryWallet.address),
        signTransaction: signer.signTransaction.bind(signer),
        signAllTransactions: signer.signAllTransactions.bind(signer),
      } as unknown as import("@solana/wallet-adapter-react").AnchorWallet;
      await acceptCounter(connection, anchorWallet, ids);
    } catch (err) {
      console.error("Accept counter offer failed", err);
    } finally {
      acceptingRef.current = false;
      setAccepting(false);
    }
  }

  function handleAcceptAll() {
    const activeCounterOffers = counterOffers.filter(
      (co) => co.status === "active",
    );
    handleAccept(activeCounterOffers.map((co) => co.id));
  }

  function handleAcceptSelected() {
    handleAccept([...selectedIds]);
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear()}`;
  }

  function shortWallet(address: string) {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  }

  function isExpiringSoon(expiryIso: string) {
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    return new Date(expiryIso).getTime() - Date.now() < sevenDays;
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

  const priceSOL = (offer.price_lamports / 1_000_000_000).toFixed(4);
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
          onClick={() => navigate("/dashboard")}
        >
          ← Back
        </button>
      </header>

      <main className={s.content}>
        <div className={s.offersSection}>
          <div className={s.offerCardTop}>
            <div className={s.offerInfo}>
              <div className={s.offerMeta}>
                <h1 className={s.offerName}>{offer.name}</h1>
                {offer.description && (
                  <p className={s.offerDescription}>{offer.description}</p>
                )}
              </div>
              <p className={s.offerPrice}>{priceSOL} SOL</p>
              <p className={s.offerQuantity}>
                {offer.unlimited ? 'Unlimited' : `${offer.quantity - offer.quantity_sold} of ${offer.quantity} remaining`}
              </p>
            </div>
            <div className={s.offerCardRight}>
              <span className={`${s.statusBadge} ${statusClass(offer.status)}`}>
                {offer.status}
              </span>
            </div>
          </div>

          {canAct && (
            <div className={s.offerTopActions}>
              <button
                className={s.pauseButton}
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
                    ? "Pause offer"
                    : "Resume offer"}
              </button>
              <button className={s.cancelButton} onClick={handleCancelClick} disabled={toggling}>
                <CloseIcon />
                Cancel offer
              </button>
            </div>
          )}

          <div className={s.offerBottomActions}>
            <a
              href={`/pay/${offer.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className={s.viewPageButton}
            >
              View page
            </a>
            <button className={s.downloadQrButton} onClick={handleDownloadQr}>
              Download QR
            </button>
          </div>

          {counterOffers.length > 0 && (
            <section className={s.counterOffersSection}>
              <div className={s.counterOffersHeader}>
                <h2 className={s.counterOffersTitle}>Counter offers</h2>
                <div className={s.counterOffersStats}>
                  <div className={s.counterOffersStat}>
                    <span className={s.counterOffersStatLabel}>
                      Expiring in 7 days
                    </span>
                    <span className={s.counterOffersStatValue}>
                      {(
                        counterOffers
                          .filter(
                            (co) =>
                              co.status === "active" &&
                              isExpiringSoon(co.expiry_at),
                          )
                          .reduce((sum, co) => sum + co.amount, 0) /
                        1_000_000_000
                      ).toFixed(4)}{" "}
                      SOL
                    </span>
                  </div>
                  <div className={s.counterOffersStat}>
                    <span className={s.counterOffersStatLabel}>
                      Total if accepted
                    </span>
                    <span className={s.counterOffersStatValue}>
                      {(
                        counterOffers
                          .filter((co) => co.status === "active")
                          .reduce((sum, co) => sum + co.amount, 0) /
                        1_000_000_000
                      ).toFixed(4)}{" "}
                      SOL
                    </span>
                  </div>
                  <div className={s.counterOffersActions}>
                    <button
                      className={s.acceptSelectedButton}
                      disabled={accepting || selectedIds.size === 0}
                      onClick={handleAcceptSelected}
                    >
                      {accepting ? "Accepting…" : "Accept selected"}
                    </button>
                    <button
                      className={s.acceptAllButton}
                      disabled={accepting}
                      onClick={handleAcceptAll}
                    >
                      {accepting ? "Accepting…" : "Accept all"}
                    </button>
                  </div>
                </div>
              </div>
              {(() => {
                const hasSelection = selectedIds.size > 0;
                const activeOffers = counterOffers.filter(
                  (co) => co.status === "active",
                );
                const displayed = hasSelection
                  ? counterOffers.filter((co) => selectedIds.has(co.id))
                  : activeOffers;
                const totalAmount = displayed.reduce(
                  (sum, co) => sum + co.amount,
                  0,
                );
                const totalQty = displayed.reduce(
                  (sum, co) => sum + co.quantity,
                  0,
                );
                const avgPrice = totalQty > 0 ? totalAmount / totalQty : 0;
                return (
                  <div className={s.selectionSummary}>
                    <div className={s.selectionSummaryItem}>
                      <span className={s.selectionSummaryLabel}>
                        {hasSelection
                          ? "Selected offers"
                          : "If accepting all offers"}
                      </span>
                      <span className={s.selectionSummaryValue}>
                        {displayed.length}
                      </span>
                    </div>
                    <div className={s.selectionSummarySep} />
                    <div className={s.selectionSummaryItem}>
                      <span className={s.selectionSummaryLabel}>
                        Avg price / product
                      </span>
                      <span className={s.selectionSummaryValue}>
                        {(avgPrice / 1_000_000_000).toFixed(4)} SOL
                      </span>
                    </div>
                    <div className={s.selectionSummarySep} />
                    <div className={s.selectionSummaryItem}>
                      <span className={s.selectionSummaryLabel}>
                        You will receive
                      </span>
                      <span
                        className={`${s.selectionSummaryValue} ${s.selectionSummaryTotal}`}
                      >
                        {(totalAmount / 1_000_000_000).toFixed(4)} SOL
                      </span>
                    </div>
                  </div>
                );
              })()}
              {[...counterOffers]
                .sort((a, b) => {
                  if (a.status === "confirmed" && b.status !== "confirmed")
                    return 1;
                  if (a.status !== "confirmed" && b.status === "confirmed")
                    return -1;
                  return b.amount - a.amount;
                })
                .map((co) => (
                  <div
                    key={co.id}
                    className={`${s.counterOfferRow} ${co.status === "confirmed" ? s.counterOfferRowConfirmed : ""}`}
                  >
                    <div className={s.counterOfferMeta}>
                      <span className={s.counterOfferDate}>
                        {formatDate(co.created_at)}
                      </span>
                      <span className={s.counterOfferWallet}>
                        From wallet: {shortWallet(co.buyer_wallet)}
                      </span>
                      <span className={s.counterOfferAmount}>
                        {(co.amount / 1_000_000_000).toFixed(4)} SOL
                      </span>
                      <span className={s.counterOfferExpiry}>
                        Expire on {formatDate(co.expiry_at)}
                      </span>
                    </div>
                    <div className={s.counterOfferActions}>
                      {co.status === "confirmed" ? (
                        <span className={s.counterOfferStatusConfirmed}>
                          confirmed
                        </span>
                      ) : (
                        <>
                          <span
                            className={
                              isExpiringSoon(co.expiry_at)
                                ? s.counterOfferStatusExpiring
                                : s.counterOfferStatusActive
                            }
                          >
                            {isExpiringSoon(co.expiry_at)
                              ? "expiring soon"
                              : "active"}
                          </span>
                          <button
                            className={s.acceptButton}
                            disabled={accepting}
                            onClick={() => handleAccept([co.id])}
                          >
                            Accept
                          </button>
                          <input
                            type="checkbox"
                            className={s.counterOfferCheckbox}
                            checked={selectedIds.has(co.id)}
                            onChange={() => toggleSelect(co.id)}
                          />
                        </>
                      )}
                    </div>
                  </div>
                ))}
            </section>
          )}
        </div>
      </main>
    </div>

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
