import { useState } from 'react'
import s from '../styles/dashboard.module.css'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (name: string, description: string, priceLamports: number) => void
  creating: boolean
}

export default function AddOfferModal({ open, onClose, onSubmit, creating }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')

  if (!open) return null

  function handleClose() {
    onClose()
  }

  const canSubmit = name.length >= 3 && description.length >= 3 && !!price && !creating

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
            <label className={s.modalLabel}>Price (SOL)</label>
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

        <div className={s.modalActions}>
          <button className={s.modalCancelButton} onClick={handleClose}>
            Cancel
          </button>
          <button
            className={s.modalSubmitButton}
            disabled={!canSubmit}
            onClick={() =>
              onSubmit(name, description, Math.round(parseFloat(price) * 1_000_000_000))
            }
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
