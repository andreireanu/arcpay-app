import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import QRCode from "qrcode";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  insertOffer,
  pauseOffer,
  resumeOffer,
  cancelOffer,
} from "../supabase/offers/offers";
import { registerSellerIfNew } from "../supabase/sellers/sellers";
import { getProduct } from "../supabase/products/products";
import { getActiveChain } from "../supabase/auth/auth";
import { getAutoAcceptForOffers } from "../supabase/autoAccept/autoAccept";
import { cancelOfferAsSeller } from "../dispatcher/actions";
import type { Offer } from "../types/offer";
import type { CounterOffer } from "../types/counterOffer";
import type { AutoAccept } from "../types/autoAccept";
import AddOfferModal from "./AddOfferModal";
import AutoAcceptButton from "./AutoAcceptButton";
import SuiIcon from "../assets/icons/SuiIcon";
import SolIcon from "../assets/icons/SolIcon";
import PauseIcon from "../assets/icons/PauseIcon";
import PlayIcon from "../assets/icons/PlayIcon";
import CloseIcon from "../assets/icons/CloseIcon";
import MenuIcon from "../assets/icons/MenuIcon";
import LinkIcon from "../assets/icons/LinkIcon";
import DownloadIcon from "../assets/icons/DownloadIcon";
import s from "../styles/dashboard.module.css";

const QR_PRODUCT_ID = "2b78e60b-533d-469d-937e-aa462dc37c28";

interface ProductsGridProps {
  title: string;
  offers: Offer[];
  setOffers: React.Dispatch<React.SetStateAction<Offer[]>>;
  counterOffers: CounterOffer[];
  /** When set, only the first N offers render. */
  initialVisible?: number;
  /** With initialVisible, shows a "View all" link instead of the rest. */
  onViewAll?: () => void;
  /** With initialVisible, shows a "Show more" button that reveals N more per click. */
  paginate?: boolean;
}

export default function ProductsGrid({
  title,
  offers,
  setOffers,
  counterOffers,
  initialVisible,
  onViewAll,
  paginate,
}: ProductsGridProps) {
  const { primaryWallet } = useDynamicContext();
  const { connection } = useConnection();
  const navigate = useNavigate();
  const walletAddress = primaryWallet?.address;

  const [offerModalOpen, setOfferModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [cancelTarget, setCancelTarget] = useState<Offer | null>(null);
  const [cancelCountdown, setCancelCountdown] = useState(10);
  const [canceling, setCanceling] = useState(false);
  const cancelWasActiveRef = useRef(false);

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuWrapRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const [autoAcceptByOffer, setAutoAcceptByOffer] = useState<
    Record<string, AutoAccept>
  >({});

  const [visibleCount, setVisibleCount] = useState(initialVisible ?? 0);

  const isLimited = onViewAll != null && initialVisible != null;
  const isPaginated = paginate === true && initialVisible != null;
  const shown = isLimited
    ? offers.slice(0, initialVisible)
    : isPaginated
      ? offers.slice(0, visibleCount)
      : offers;
  const showViewAll = isLimited && offers.length > initialVisible!;
  const showMore = isPaginated && offers.length > visibleCount;

  useEffect(() => {
    if (!menuOpenId) return;
    function handleClick(e: MouseEvent) {
      const wrap = menuWrapRefs.current[menuOpenId!];
      if (wrap && !wrap.contains(e.target as Node)) setMenuOpenId(null);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpenId]);

  useEffect(() => {
    if (!cancelTarget || cancelCountdown <= 0) return;
    const t = setTimeout(() => setCancelCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cancelTarget, cancelCountdown]);

  // Batch-load every offer's auto-accept rule so each card's button shows its
  // on/off state without a query per card.
  const offerIdKey = offers.map((o) => o.id).join(",");
  useEffect(() => {
    const ids = offerIdKey ? offerIdKey.split(",") : [];
    getAutoAcceptForOffers(ids).then(setAutoAcceptByOffer).catch(console.error);
  }, [offerIdKey]);

  async function handleCreateOffer(
    name: string,
    description: string,
    priceLamports: number,
    quantity: number,
    unlimited: boolean,
  ) {
    if (!walletAddress) return;
    setCreating(true);
    try {
      await registerSellerIfNew(walletAddress);
      const product = await getProduct(QR_PRODUCT_ID);
      // Record the offer on the chain the seller logged in with.
      const offer = await insertOffer(
        walletAddress,
        name,
        description,
        priceLamports,
        product.fee_bps,
        quantity,
        unlimited,
        getActiveChain(),
      );
      setOffers((prev) => [offer, ...prev]);
      setOfferModalOpen(false);
    } catch (err) {
      console.error("Failed to create offer", err);
    } finally {
      setCreating(false);
    }
  }

  async function handleTogglePause(offer: Offer, e: React.MouseEvent) {
    e.stopPropagation();
    setTogglingId(offer.id);
    try {
      if (offer.status === "active") {
        await pauseOffer(offer.id);
        setOffers((prev) =>
          prev.map((o) => (o.id === offer.id ? { ...o, status: "paused" } : o)),
        );
      } else {
        await resumeOffer(offer.id);
        setOffers((prev) =>
          prev.map((o) => (o.id === offer.id ? { ...o, status: "active" } : o)),
        );
      }
    } catch (err) {
      console.error("Failed to toggle pause", err);
    } finally {
      setTogglingId(null);
    }
  }

  async function handleCancelClick(offer: Offer, e: React.MouseEvent) {
    e.stopPropagation();
    if (togglingId === offer.id) return;
    cancelWasActiveRef.current = offer.status === "active";
    if (offer.status === "active") {
      setTogglingId(offer.id);
      try {
        await pauseOffer(offer.id);
        setOffers((prev) =>
          prev.map((o) => (o.id === offer.id ? { ...o, status: "paused" } : o)),
        );
      } catch (err) {
        console.error("Failed to pause before cancel", err);
        setTogglingId(null);
        return;
      }
      setTogglingId(null);
    }
    setCancelCountdown(10);
    setCancelTarget(offer);
  }

  async function handleCancelDismiss() {
    if (canceling) return;
    if (cancelWasActiveRef.current && cancelTarget) {
      try {
        await resumeOffer(cancelTarget.id);
        setOffers((prev) =>
          prev.map((o) =>
            o.id === cancelTarget.id ? { ...o, status: "active" } : o,
          ),
        );
      } catch (err) {
        console.error("Failed to resume offer", err);
      }
    }
    setCancelTarget(null);
  }

  async function handleCancelConfirm() {
    if (!cancelTarget || canceling) return;
    setCanceling(true);
    try {
      const activeForOffer = counterOffers.filter(
        (co) => co.offer_id === cancelTarget.id && co.status === "active",
      );
      if (activeForOffer.length === 0) {
        await cancelOffer(cancelTarget.id);
        setOffers((prev) =>
          prev.map((o) =>
            o.id === cancelTarget.id ? { ...o, status: "canceled" } : o,
          ),
        );
        setCancelTarget(null);
        return;
      }
      if (!primaryWallet) return;
      await cancelOfferAsSeller(primaryWallet, connection, cancelTarget);
      setCancelTarget(null);
    } catch (err) {
      console.error("Failed to cancel offer", err);
      if (cancelTarget) {
        try {
          await resumeOffer(cancelTarget.id);
          setOffers((prev) =>
            prev.map((o) =>
              o.id === cancelTarget.id ? { ...o, status: "active" } : o,
            ),
          );
        } catch {
          // Best-effort rollback — if resuming also fails there's nothing more to do.
        }
      }
    } finally {
      setCanceling(false);
    }
  }

  async function handleDownloadQr(offer: Offer, e: React.MouseEvent) {
    e.stopPropagation();
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

  function statusClass(status: Offer["status"]) {
    if (status === "active") return s.statusActive;
    if (status === "paused") return s.statusPaused;
    if (status === "canceled") return s.statusCanceled;
    if (status === "sold") return s.statusSold;
    return "";
  }

  const canAct = (o: Offer) => o.status === "active" || o.status === "paused";

  return (
    <section className={s.offersSection}>
      <div className={s.offersSectionHeader}>
        <h2 className={s.sectionTitle}>{title}</h2>
        <button
          className={s.createButton}
          onClick={() => setOfferModalOpen(true)}
        >
          Create
        </button>
      </div>

      {offers.length === 0 ? (
        <p className={s.offersEmpty}>
          No offers yet. Create one to generate a QR code buyers can scan to
          pay.
        </p>
      ) : (
        <>
          <div className={s.offersGrid}>
            {shown.map((offer) => {
              const offerCoCount = counterOffers.filter(
                (co) => co.offer_id === offer.id,
              ).length;
              return (
                <div
                  key={offer.id}
                  className={s.offerCard}
                  onClick={() => navigate(`/offer/${offer.id}`)}
                >
                  <div className={s.offerCardThumb}>
                    <img src="/favicon.svg" alt="" />
                  </div>
                  <div className={s.offerCardBody}>
                    <div className={s.offerCardHead}>
                      <div className={s.offerCardInfo}>
                        <h3 className={s.offerName}>{offer.name}</h3>
                        {offer.description && (
                          <p className={s.offerDescription}>
                            {offer.description}
                          </p>
                        )}
                      </div>
                      <div className={s.offerDetailStatusGroup}>
                        <AutoAcceptButton
                          offer={offer}
                          rule={autoAcceptByOffer[offer.id] ?? null}
                          compact
                        />
                        <span
                          className={`${s.statusBadge} ${statusClass(offer.status)}`}
                        >
                          {offer.status}
                        </span>
                      </div>
                    </div>
                    <div
                      className={s.offerCardBottom}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className={s.offerCardPrice}>
                        {offer.chain === "sui" ? (
                          <SuiIcon size={18} />
                        ) : (
                          <SolIcon size={18} />
                        )}
                        <span>
                          {(offer.price_lamports / 1e9).toFixed(4)}{" "}
                          {offer.chain === "sui" ? "SUI" : "SOL"}
                        </span>
                      </div>
                      <span
                        className={`${s.offerCardPill} ${s.offerCardAvailPill}`}
                      >
                        {offer.unlimited
                          ? "Unlimited"
                          : `${offer.quantity - offer.quantity_sold} of ${offer.quantity} Available`}
                      </span>
                      <span className={s.offerCardPill}>
                        {offerCoCount} Offers
                      </span>
                      <a
                        href={`/pay/${offer.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={s.offerCardIconBtn}
                        title="View pay page"
                      >
                        <LinkIcon />
                      </a>
                      {canAct(offer) && (
                        <div
                          className={s.offerCardMenuWrap}
                          ref={(el) => {
                            menuWrapRefs.current[offer.id] = el;
                          }}
                        >
                          <button
                            className={s.offerCardIconBtn}
                            onClick={() =>
                              setMenuOpenId((p) =>
                                p === offer.id ? null : offer.id,
                              )
                            }
                          >
                            <MenuIcon />
                          </button>
                          {menuOpenId === offer.id && (
                            <div className={s.offerCardMenuDropdown}>
                              <button
                                className={s.offerCardMenuDropdownItem}
                                disabled={togglingId === offer.id}
                                onClick={(e) => {
                                  setMenuOpenId(null);
                                  handleTogglePause(offer, e);
                                }}
                              >
                                {offer.status === "active" ? (
                                  <PauseIcon size={16} />
                                ) : (
                                  <PlayIcon size={16} />
                                )}
                                {togglingId === offer.id
                                  ? offer.status === "active"
                                    ? "Pausing…"
                                    : "Resuming…"
                                  : offer.status === "active"
                                    ? "Pause"
                                    : "Resume"}
                              </button>
                              <button
                                className={s.offerCardMenuDropdownItem}
                                disabled={togglingId === offer.id}
                                onClick={(e) => {
                                  setMenuOpenId(null);
                                  handleCancelClick(offer, e);
                                }}
                              >
                                <CloseIcon size={16} />
                                Cancel
                              </button>
                              <button
                                className={s.offerCardMenuDropdownItem}
                                onClick={(e) => {
                                  setMenuOpenId(null);
                                  handleDownloadQr(offer, e);
                                }}
                              >
                                <DownloadIcon />
                                Download QR
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {showViewAll && (
            <div className={s.gridFooter}>
              <button className={s.showMoreBtn} onClick={onViewAll}>
                View all
              </button>
            </div>
          )}
          {showMore && (
            <div className={s.gridFooter}>
              <button
                className={s.showMoreBtn}
                onClick={() =>
                  setVisibleCount((c) => c + (initialVisible ?? 0))
                }
              >
                Show more
              </button>
            </div>
          )}
        </>
      )}

      {cancelTarget && (
        <div className={s.modalOverlay}>
          <div className={s.modal}>
            <h2 className={s.modalTitle}>Cancel offer</h2>
            <p className={s.offersEmpty}>
              Cancel &ldquo;{cancelTarget.name}&rdquo;? Active buyer offers will
              be refunded on-chain.
            </p>
            <div className={s.modalActions}>
              <button
                className={s.modalCancelButton}
                onClick={handleCancelDismiss}
                disabled={canceling}
              >
                Keep offer
              </button>
              <button
                className={s.modalDangerButton}
                disabled={cancelCountdown > 0 || canceling}
                onClick={handleCancelConfirm}
              >
                {cancelCountdown > 0
                  ? `Cancel in ${cancelCountdown}s`
                  : canceling
                    ? "Canceling…"
                    : "Confirm cancel"}
              </button>
            </div>
          </div>
        </div>
      )}

      <AddOfferModal
        key={String(offerModalOpen)}
        open={offerModalOpen}
        onClose={() => setOfferModalOpen(false)}
        onSubmit={handleCreateOffer}
        creating={creating}
        chain={getActiveChain()}
      />
    </section>
  );
}
