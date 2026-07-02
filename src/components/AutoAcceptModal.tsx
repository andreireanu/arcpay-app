import { useState } from "react";
import { createPortal } from "react-dom";
import type { AutoAccept } from "../types/autoAccept";
import { useEscapeKey } from "../hooks/useEscapeKey";
import CloseIcon from "../assets/icons/CloseIcon";
import s from "../styles/dashboard.module.css";

interface Props {
  onClose: () => void;
  onSave: (quantity: number, avgPriceLamports: number) => void;
  onTurnOff: () => void;
  saving: boolean;
  /** The offer's chain — drives the price currency label. */
  chain: "solana" | "sui";
  /** The current rule, if one is set (drives prefill + turn-off + last-fired). */
  existing: AutoAccept | null;
}

export default function AutoAcceptModal({
  onClose,
  onSave,
  onTurnOff,
  saving,
  chain,
  existing,
}: Props) {
  // Mounted only while open, so the initializers seed the inputs from the
  // current rule on each open.
  const [quantity, setQuantity] = useState(
    existing ? String(existing.quantity) : "",
  );
  const [price, setPrice] = useState(
    existing ? String(existing.avg_price / 1_000_000_000) : "",
  );

  useEscapeKey(!saving, onClose);

  // Both SOL and SUI use 9 decimals, so the price→base-unit conversion is the
  // same; only the label differs.
  const currency = chain === "sui" ? "SUI" : "SOL";

  const canSave =
    parseInt(quantity) >= 1 && !!price && parseFloat(price) > 0 && !saving;

  function handleSave() {
    onSave(parseInt(quantity), Math.round(parseFloat(price) * 1_000_000_000));
  }

  return createPortal(
    <div
      className={s.modalOverlay}
      onClick={(e) => {
        e.stopPropagation();
        if (!saving) onClose();
      }}
    >
      <div className={s.modal} onClick={(e) => e.stopPropagation()}>
        <div className={s.modalHeader}>
          <h2 className={s.modalTitle}>Auto accept</h2>
          <button
            className={s.modalClose}
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        <p className={s.modalDescription}>
          Sell automatically if the price is right. Choose how many of the best
          offers to accept and the minimum average price you'll take. The moment
          that many active offers exist and their average price reaches your
          minimum, the top offers are accepted and paid out to you
          automatically. It runs once, then turns off so save again to re-arm
          it.
        </p>

        <div className={s.modalFields}>
          <div className={s.modalField}>
            <label className={s.modalLabel}>Number of offers to accept</label>
            <input
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="e.g. 5"
              min="1"
              step="1"
              className={s.modalInput}
            />
          </div>
          <div className={s.modalField}>
            <label className={s.modalLabel}>
              Minimum average price ({currency})
            </label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              min="0"
              step="0.01"
              className={s.modalInput}
            />
          </div>
        </div>

        {existing?.triggered_at && (
          <p className={s.modalDescription}>
            Last fired {new Date(existing.triggered_at).toLocaleString()} at an
            average of{" "}
            {(Number(existing.triggered_price ?? 0) / 1_000_000_000).toFixed(4)}{" "}
            {currency}.
          </p>
        )}

        <div className={s.modalActions}>
          {existing ? (
            <button
              className={s.modalCancelButton}
              onClick={onTurnOff}
              disabled={saving}
            >
              Turn off
            </button>
          ) : (
            <button
              className={s.modalCancelButton}
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
          )}
          <button
            className={s.modalSubmitButton}
            disabled={!canSave}
            onClick={handleSave}
          >
            {saving ? "Saving…" : existing ? "Update" : "Enable"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
