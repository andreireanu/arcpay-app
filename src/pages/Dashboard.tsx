import { useEffect, useState } from 'react'
import { useSolanaWallets } from '@privy-io/react-auth/solana'
import QRCode from 'qrcode'
import { useAuth } from '../hooks/useAuth'
import {
  getOffersByWallet,
  insertOffer,
  pauseOffer,
  resumeOffer,
  cancelOffer,
  watchOfferStatuses,
} from '../supabase/offers/offers'
import { getProduct } from '../supabase/products/products'
import type { Offer } from '../types/offer'
import AddOfferModal from '../components/AddOfferModal'
import s from '../styles/dashboard.module.css'

const QR_PRODUCT_ID = '2b78e60b-533d-469d-937e-aa462dc37c28'

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  )
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M5 3l14 9-14 9V3z" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

export default function Dashboard() {
  const { signOutUser } = useAuth()
  const { wallets } = useSolanaWallets()
  const walletAddress = wallets[0]?.address
  const [offers, setOffers] = useState<Offer[]>([])
  const [offerModalOpen, setOfferModalOpen] = useState(false)
  const [togglingOffer, setTogglingOffer] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!walletAddress) return
    getOffersByWallet(walletAddress).then(setOffers).catch(console.error)
  }, [walletAddress])

  const offerIds = offers.map((o) => o.id)
  useEffect(() => {
    if (offerIds.length === 0) return
    return watchOfferStatuses(offerIds, (offerId, update) => {
      setOffers((prev) => prev.map((o) => (o.id === offerId ? { ...o, ...update } : o)))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offerIds.join(',')])

  async function handleSignOut() {
    await signOutUser()
  }

  async function handleCreateOffer(name: string, description: string, priceLamports: number, quantity: number) {
    if (!walletAddress) return
    setCreating(true)
    try {
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

  async function handlePause(offer: Offer) {
    setTogglingOffer(offer.id)
    await pauseOffer(offer.id)
    setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: 'paused' } : o)))
    setTogglingOffer(null)
  }

  async function handleResume(offer: Offer) {
    setTogglingOffer(offer.id)
    await resumeOffer(offer.id)
    setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: 'active' } : o)))
    setTogglingOffer(null)
  }

  async function handleCancel(offer: Offer) {
    await cancelOffer(offer.id)
    setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: 'canceled' } : o)))
  }

  async function handleDownloadQr(offer: Offer) {
    const url = `${window.location.origin}/pay/${offer.id}`
    let svg: string = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'H' })
    try {
      const resp = await fetch('/favicon.svg')
      if (resp.ok) {
        const b64 = btoa(await resp.text())
        const logoData = `data:image/svg+xml;base64,${b64}`
        const match = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/)
        if (match) {
          const w = parseFloat(match[1])
          const h = parseFloat(match[2])
          const logoSize = Math.round(w * 0.22)
          const x = Math.round((w - logoSize) / 2)
          const y = Math.round((h - logoSize) / 2)
          const overlay = `<image href="${logoData}" x="${x}" y="${y}" width="${logoSize}" height="${logoSize}"/>`
          svg = svg.replace('</svg>', `${overlay}</svg>`)
        }
      }
    } catch { /* download without logo if fetch fails */ }
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${offer.name}-qr.svg`
    a.click()
    URL.revokeObjectURL(a.href)
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
          <button className={s.signOutButton} onClick={handleSignOut}>
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
                <div key={offer.id} className={s.offerCard}>
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
                    <div className={s.offerCardRight}>
                      <span className={`${s.statusBadge} ${statusClass(offer.status)}`}>
                        {offer.status}
                      </span>
                      {(offer.status === 'active' || offer.status === 'paused') && (
                        <div className={s.offerTopActions}>
                          <button
                            className={s.pauseButton}
                            disabled={togglingOffer === offer.id}
                            onClick={() =>
                              offer.status === 'active'
                                ? handlePause(offer)
                                : handleResume(offer)
                            }
                          >
                            {offer.status === 'active' ? <PauseIcon /> : <PlayIcon />}
                            {togglingOffer === offer.id
                              ? offer.status === 'active' ? 'Pausing…' : 'Resuming…'
                              : offer.status === 'active' ? 'Pause offer' : 'Resume offer'}
                          </button>
                          <button
                            className={s.cancelButton}
                            onClick={() => handleCancel(offer)}
                          >
                            <CloseIcon />
                            Cancel offer
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={s.offerBottomActions}>
                    <a
                      href={`/pay/${offer.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={s.viewPageButton}
                    >
                      View page
                    </a>
                    <button
                      className={s.downloadQrButton}
                      onClick={() => handleDownloadQr(offer)}
                    >
                      Download QR
                    </button>
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
