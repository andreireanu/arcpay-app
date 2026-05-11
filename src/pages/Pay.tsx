import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { getOffer, watchOfferStatus } from '../supabase/offers/offers'
import { buy } from '../solana/instructions/buy'
import type { Offer } from '../types/offer'
import s from '../styles/pay.module.css'

export default function Pay() {
  const { offerId } = useParams<{ offerId: string }>()
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(true)
  const [buying, setBuying] = useState(false)
  const [bought, setBought] = useState(false)
  const [waitingConfirmation, setWaitingConfirmation] = useState(false)
  const waitingConfirmationRef = useRef(false)
  const [buyError, setBuyError] = useState<string | null>(null)

  const anchorWallet = useAnchorWallet()
  const { connected } = useWallet()
  const { connection } = useConnection()
  const { setVisible: openWalletModal } = useWalletModal()

  useEffect(() => {
    if (!offerId) return
    getOffer(offerId)
      .then(setOffer)
      .catch(console.error)
      .finally(() => setLoading(false))

    const unsubscribe = watchOfferStatus(offerId, (status) => {
      setOffer((prev) => (prev ? { ...prev, status: status as Offer['status'] } : prev))
      if (status === 'sold' && waitingConfirmationRef.current) {
        waitingConfirmationRef.current = false
        setWaitingConfirmation(false)
        setBought(true)
      }
    })
    return unsubscribe
  }, [offerId])

  async function handleBuy() {
    if (!anchorWallet || !connected || !offerId) return
    setBuyError(null)
    setBuying(true)
    try {
      await buy(connection, anchorWallet, offerId)
      waitingConfirmationRef.current = true
      setWaitingConfirmation(true)
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setBuying(false)
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
  const canBuy = offer.status === 'active' && !bought

  function unavailableClass() {
    if (offer!.status === 'paused') return s.unavailablePaused
    if (offer!.status === 'canceled') return s.unavailableCanceled
    if (offer!.status === 'sold') return s.unavailableSold
    return ''
  }

  function unavailableLabel() {
    if (offer!.status === 'paused') return 'This listing is currently paused.'
    if (offer!.status === 'canceled') return 'This listing has been canceled.'
    if (offer!.status === 'sold') return 'This item has already been sold.'
    return `This listing is ${offer!.status}.`
  }

  return (
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

        {bought ? (
          <p className={s.successMessage}>Payment confirmed!</p>
        ) : waitingConfirmation ? (
          <p className={s.statusMessage}>Transaction sent, waiting for confirmation…</p>
        ) : canBuy ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {connected ? (
              <button className={s.buyButton} onClick={handleBuy} disabled={buying}>
                {buying ? 'Confirm in wallet…' : 'BUY'}
              </button>
            ) : (
              <button className={s.connectButton} onClick={() => openWalletModal(true)}>
                Connect wallet
              </button>
            )}
            {buyError && <p className={s.errorMessage}>{buyError}</p>}
          </div>
        ) : (
          <span className={`${s.unavailableBadge} ${unavailableClass()}`}>
            {unavailableLabel()}
          </span>
        )}
      </div>
    </div>
  )
}
