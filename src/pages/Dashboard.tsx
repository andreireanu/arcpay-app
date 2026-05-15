import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { useAuth } from '../hooks/useAuth'
import { getOffersByWallet, insertOffer, watchOfferStatuses } from '../supabase/offers/offers'
import { registerSellerIfNew } from '../supabase/sellers/sellers'
import { getProduct } from '../supabase/products/products'
import type { Offer } from '../types/offer'
import AddOfferModal from '../components/AddOfferModal'
import s from '../styles/dashboard.module.css'

const QR_PRODUCT_ID = '2b78e60b-533d-469d-937e-aa462dc37c28'

export default function Dashboard() {
  const { signOutUser } = useAuth()
  const { primaryWallet } = useDynamicContext()
  const navigate = useNavigate()
  const walletAddress = primaryWallet?.address
  const [offers, setOffers] = useState<Offer[]>([])
  const [offerModalOpen, setOfferModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!walletAddress) return
    getOffersByWallet(walletAddress).then(setOffers).catch(console.error)
  }, [walletAddress])

  useEffect(() => {
    if (offers.length === 0) return
    const ids = offers.map((o) => o.id)
    return watchOfferStatuses(ids, (offerId, update) => {
      setOffers((prev) =>
        prev.map((o) => (o.id === offerId ? { ...o, ...update } : o))
      )
    })
  }, [offers.map((o) => o.id).join(',')])

  async function handleCreateOffer(name: string, description: string, priceLamports: number, quantity: number) {
    if (!walletAddress) return
    setCreating(true)
    try {
      await registerSellerIfNew(walletAddress)
      const product = await getProduct(QR_PRODUCT_ID)
      const offer = await insertOffer(walletAddress, name, description, priceLamports, product.fee_bps, quantity)
      setOffers((prev) => [offer, ...prev])
      setOfferModalOpen(false)
    } catch (err) {
      console.error('Failed to create offer', err)
    } finally {
      setCreating(false)
    }
  }

  function statusClass(status: Offer['status']) {
    if (status === 'active') return s.statusActive
    if (status === 'paused') return s.statusPaused
    if (status === 'canceled') return s.statusCanceled
    if (status === 'sold') return s.statusSold
    return ''
  }

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : null

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.logo}>
          <img src="/favicon.svg" alt="" className={s.logoIcon} />
          <span className={s.logoWordmark}>arcpay</span>
        </div>
        <div className={s.headerActions}>
          {shortAddress && (
            <button
              className={s.walletButton}
              onClick={() => {
                navigator.clipboard.writeText(walletAddress!)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              title={walletAddress}
            >
              {copied ? '✓ Copied' : shortAddress}
            </button>
          )}
          <button className={s.signOutButton} onClick={() => signOutUser()}>
            Sign out
          </button>
        </div>
      </header>

      <main className={s.content}>
        <section className={s.offersSection}>
          <div className={s.offersSectionHeader}>
            <h2 className={s.sectionTitle}>QR Offers</h2>
            <button className={s.createButton} onClick={() => setOfferModalOpen(true)}>
              Create
            </button>
          </div>

          {offers.length === 0 ? (
            <p className={s.offersEmpty}>
              No offers yet. Create one to generate a QR code buyers can scan to pay.
            </p>
          ) : (
            <div className={s.offersGrid}>
              {offers.map((offer) => (
                <div
                  key={offer.id}
                  className={s.offerCard}
                  onClick={() => navigate(`/offers/${offer.id}`)}
                  style={{ cursor: 'pointer' }}
                >
                  <div className={s.offerCardTop}>
                    <div className={s.offerInfo}>
                      <div className={s.offerMeta}>
                        <h3 className={s.offerName}>{offer.name}</h3>
                        {offer.description && (
                          <p className={s.offerDescription}>{offer.description}</p>
                        )}
                      </div>
                      <p className={s.offerPrice}>
                        {(offer.price_lamports / 1_000_000_000).toFixed(4)} SOL
                      </p>
                      <p className={s.offerQuantity}>
                        {offer.quantity - offer.quantity_sold} of {offer.quantity} remaining
                      </p>
                    </div>
                    <span className={`${s.statusBadge} ${statusClass(offer.status)}`}>
                      {offer.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <AddOfferModal
        key={String(offerModalOpen)}
        open={offerModalOpen}
        onClose={() => setOfferModalOpen(false)}
        onSubmit={handleCreateOffer}
        creating={creating}
      />
    </div>
  )
}
