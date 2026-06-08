import { useState } from "react";
import s from "../styles/dashboard.module.css";

const UNLIMITED_SENTINEL = 2_147_483_647;

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (
    name: string,
    description: string,
    priceLamports: number,
    quantity: number,
    unlimited: boolean,
  ) => void;
  creating: boolean;
}

export default function AddOfferModal({
  open,
  onClose,
  onSubmit,
  creating,
}: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [limitQuantity, setLimitQuantity] = useState(false);
  const [quantity, setQuantity] = useState("1");

  if (!open) return null;

  const canSubmit =
    name.length >= 3 &&
    description.length >= 3 &&
    !!price &&
    (!limitQuantity || parseInt(quantity) >= 1) &&
    !creating;

  function handleSubmit() {
    const priceLamports = Math.round(parseFloat(price) * 1_000_000_000);
    const qty = limitQuantity ? parseInt(quantity) : UNLIMITED_SENTINEL;
    onSubmit(name, description, priceLamports, qty, !limitQuantity);
  }

  return (
    <div className={s.modalOverlay}>
      <div className={s.modal}>
        <h2 className={s.modalTitle}>New offer</h2>

        <div className={s.modalFields}>
          <div className={s.modalField}>
            <label className={s.modalLabel}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Vintage camera"
              className={s.modalInput}
            />
          </div>
          <div className={s.modalField}>
            <label className={s.modalLabel}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your item…"
              rows={3}
              className={s.modalTextarea}
            />
          </div>
          <div className={s.modalField}>
            <label className={s.modalLabel}>Price per unit (SOL)</label>
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
          <label className={s.checkboxRow}>
            <input
              type="checkbox"
              checked={limitQuantity}
              onChange={(e) => setLimitQuantity(e.target.checked)}
              className={s.checkbox}
            />
            <span className={s.checkboxLabel}>Limit quantity</span>
          </label>
          {limitQuantity && (
            <div className={s.modalField}>
              <label className={s.modalLabel}>Quantity</label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
                min="1"
                step="1"
                className={s.modalInput}
              />
            </div>
          )}
        </div>

        <div className={s.modalActions}>
          <button className={s.modalCancelButton} onClick={onClose}>
            Cancel
          </button>
          <button
            className={s.modalSubmitButton}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {creating ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
