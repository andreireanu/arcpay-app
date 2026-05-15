import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { isSolanaWallet } from '@dynamic-labs/solana-core'
import { getOffer } from '../supabase/offers/offers'
import { submitCounterOffer } from '../supabase/offers/counterOffers'
import { buy } from '../solana/instructions/buy'
import type { Offer } from '../types/offer'
import s from '../styles/pay.module.css'

export default function Pay() {
  const { offerId } = useParams<{ offerId: string }>()
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(true)
  const [counterOfferOpen, setCounterOfferOpen] = useState(false)
  const [counterPrice, setCounterPrice] = useState('')
  const [buying, setBuying] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const { connection } = useConnection()
  const { primaryWallet, setShowAuthFlow } = useDynamicContext()
  const connected = !!primaryWallet && isSolanaWallet(primaryWallet)
  const publicKey = connected ? new PublicKey(primaryWallet.address) : null

  useEffect(() => {
    if (!offerId) return
    getOffer(offerId)
      .then(setOffer)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [offerId])

  async function handleBuy() {
    if (!connected || !primaryWallet || !offerId || buying) return
    setBuying(true)
    const signer = await primaryWallet.getSigner()
    const anchorWallet = {
      publicKey: new PublicKey(primaryWallet.address),
      signTransaction: signer.signTransaction.bind(signer),
      signAllTransactions: signer.signAllTransactions.bind(signer),
    } as unknown as import('@solana/wallet-adapter-react').AnchorWallet
    try {
      await buy(connection, anchorWallet, offerId)
    } finally {
      setBuying(false)
    }
  }

  async function handleSubmitCounterOffer() {
    if (!offerId || !publicKey || !counterPrice) return
    const lamports = Math.round(parseFloat(counterPrice) * 1_000_000_000)
    if (!lamports || lamports <= 0) return
    setSubmitting(true)
    try {
      await submitCounterOffer(offerId, publicKey.toBase58(), lamports)
      setSubmitted(true)
      setCounterOfferOpen(false)
      setCounterPrice('')
    } catch (err) {
      console.error('Failed to submit counter offer', err)
    } finally {
      setSubmitting(false)
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
    )
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
    )
  }

  const priceSOL = (offer.price_lamports / 1_000_000_000).toFixed(4)
  const isAvailable = offer.status === 'active'

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
            <span className={`${s.unavailableBadge} ${
              offer.status === 'paused' ? s.unavailablePaused :
              offer.status === 'sold' ? s.unavailableSold :
              s.unavailableCanceled
            }`}>
              {offer.status === 'paused' ? 'Paused' : offer.status === 'sold' ? 'Sold out' : 'Cancelled'}
            </span>
          ) : submitted ? (
            <p className={s.successMessage}>Counter offer submitted!</p>
          ) : (
            <div className={s.actions}>
              {connected ? (
                <button className={s.buyButton} onClick={handleBuy} disabled={buying}>
                  {buying ? 'Buying…' : 'BUY'}
                </button>
              ) : (
                <button className={s.connectButton} onClick={() => setShowAuthFlow(true)}>
                  Connect wallet
                </button>
              )}

              {connected && (
                <>
                  <div className={s.counterOfferHint}>
                    <p className={s.counterOfferHintBold}>Not ready to pay full price?</p>
                    <p className={s.counterOfferHintText}>
                      You can submit an offer for this item at a price that works for you.
                    </p>
                  </div>
                  <button className={s.createOfferButton} onClick={() => setCounterOfferOpen(true)}>
                    Create offer
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {counterOfferOpen && (
        <div className={s.modalOverlay} onClick={() => setCounterOfferOpen(false)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <h2 className={s.modalTitle}>Make an offer</h2>
            <div className={s.modalField}>
              <label className={s.modalLabel}>Your price (SOL)</label>
              <input
                className={s.modalInput}
                type="number"
                step="0.0001"
                min="0"
                placeholder="0.0000"
                value={counterPrice}
                onChange={(e) => setCounterPrice(e.target.value)}
              />
            </div>
            <div className={s.modalActions}>
              <button className={s.modalCancelButton} onClick={() => setCounterOfferOpen(false)}>
                Cancel
              </button>
              <button
                className={s.modalSubmitButton}
                disabled={!counterPrice || parseFloat(counterPrice) <= 0 || submitting}
                onClick={handleSubmitCounterOffer}
              >
                {submitting ? 'Submitting…' : 'Submit offer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
