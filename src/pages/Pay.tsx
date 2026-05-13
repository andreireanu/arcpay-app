import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useAnchorWallet, useConnection, useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { getOffer } from '../supabase/offers/offers'
import { buy } from '../solana/instructions/buy'
import type { Offer } from '../types/offer'
import s from '../styles/pay.module.css'

export default function Pay() {
  const { offerId } = useParams<{ offerId: string }>()
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(true)

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
  }, [offerId])

  async function handleBuy() {
    if (!anchorWallet || !connected || !offerId) return
    await buy(connection, anchorWallet, offerId)
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

        {connected ? (
          <button className={s.buyButton} onClick={handleBuy}>
            BUY
          </button>
        ) : (
          <button className={s.connectButton} onClick={() => openWalletModal(true)}>
            Connect wallet
          </button>
        )}
      </div>
    </div>
  )
}
