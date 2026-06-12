import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import QRCode from 'qrcode'
import { useDynamicContext, getAuthToken } from '@dynamic-labs/sdk-react-core'
import { isSolanaWallet } from '@dynamic-labs/solana-core'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import { useAuth } from '../hooks/useAuth'
import {
  getOffersByWallet,
  insertOffer,
  watchOfferStatuses,
  pauseOffer,
  resumeOffer,
  cancelOffer,
} from '../supabase/offers/offers'
import {
  getCounterOffersBySeller,
  hideCounterOffer,
  unhideAllCounterOffers,
  watchNewCounterOffers,
  watchCounterOfferStatuses,
} from '../supabase/offers/getCounterOffers'
import { getTransactionsBySeller, watchNewTransactions, watchSettledCounterOffers } from '../supabase/transactions/transactions'
import { registerSellerIfNew } from '../supabase/sellers/sellers'
import { getProduct } from '../supabase/products/products'
import { getCurrentRole } from '../supabase/auth/auth'
import { exchangeToken } from '../supabase/auth/exchangeToken'
import { sellerCancelOffer } from '../solana/instructions/sellerCancelOffer'
import { acceptCounter } from '../solana/instructions/acceptCounter'
import type { Offer } from '../types/offer'
import type { CounterOffer } from '../types/counterOffer'
import type { Transaction } from '../types/transaction'
import AddOfferModal from '../components/AddOfferModal'
import PauseIcon from '../assets/icons/PauseIcon'
import PlayIcon from '../assets/icons/PlayIcon'
import CloseIcon from '../assets/icons/CloseIcon'
import MenuIcon from '../assets/icons/MenuIcon'
import LinkIcon from '../assets/icons/LinkIcon'
import DownloadIcon from '../assets/icons/DownloadIcon'
import SolIcon from '../assets/icons/SolIcon'
import s from '../styles/dashboard.module.css'

const QR_PRODUCT_ID = '2b78e60b-533d-469d-937e-aa462dc37c28'

export default function SellerDashboard() {
  const { signOutUser } = useAuth()
  const { primaryWallet } = useDynamicContext()
  const { connection } = useConnection()
  const navigate = useNavigate()
  const walletAddress = primaryWallet?.address

  const [offers, setOffers] = useState<Offer[]>([])
  const [offerModalOpen, setOfferModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const [role, setRole] = useState<'seller' | 'buyer'>(getCurrentRole())
  const [switchingRole, setSwitchingRole] = useState(false)
  const walletMenuRef = useRef<HTMLDivElement>(null)

  const [cancelTarget, setCancelTarget] = useState<Offer | null>(null)
  const [cancelCountdown, setCancelCountdown] = useState(10)
  const [canceling, setCanceling] = useState(false)
  const cancelWasActiveRef = useRef(false)

  const [activeTab, setActiveTab] = useState<'counteroffers' | 'transactions'>('counteroffers')
  const [allCounterOffers, setAllCounterOffers] = useState<CounterOffer[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [txLoaded, setTxLoaded] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const acceptingRef = useRef(false)

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const menuWrapRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    if (!walletAddress) return
    getOffersByWallet(walletAddress).then(setOffers).catch(console.error)
  }, [walletAddress])

  useEffect(() => {
    getCounterOffersBySeller()
      .then(({ visible, hiddenCount }) => {
        setAllCounterOffers(visible)
        setHiddenCount(hiddenCount)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (offers.length === 0) return
    const unsubs = offers.map((o) =>
      watchNewCounterOffers(o.id, (co) => {
        setAllCounterOffers((prev) => [co, ...prev])
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [offers])

  useEffect(() => {
    if (offers.length === 0) return
    const unsubs = offers.map((o) =>
      watchNewTransactions(o.id, (row) => {
        setTransactions((prev) => {
          if (prev.some((t) => t.id === row.id)) return prev
          const offer_name = offers.find((of) => of.id === row.offer_id)?.name ?? ''
          return [{ ...row, offer_name, source: 'buy' as const }, ...prev]
        })
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [offers])

  useEffect(() => {
    if (offers.length === 0) return
    const unsubs = offers.map((o) =>
      watchSettledCounterOffers(o.id, (row) => {
        setTransactions((prev) => {
          if (prev.some((t) => t.id === row.id)) return prev
          const offer_name = offers.find((of) => of.id === row.offer_id)?.name ?? ''
          return [{ ...row, offer_name, source: 'counter_offer' as const }, ...prev]
        })
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [offers])

  const coIdKey = allCounterOffers.map((co) => co.id).join(',')
  useEffect(() => {
    if (!coIdKey) return
    const ids = coIdKey.split(',')
    return watchCounterOfferStatuses(ids, (id, status) => {
      if (
        status === 'confirmed' ||
        status === 'buyer_canceled' ||
        status === 'seller_canceled'
      ) {
        setAllCounterOffers((prev) => prev.filter((co) => co.id !== id))
      } else {
        setAllCounterOffers((prev) =>
          prev.map((co) => (co.id === id ? { ...co, status } : co)),
        )
      }
    })
  }, [coIdKey])

  useEffect(() => {
    if (offers.length === 0) return
    return watchOfferStatuses(offers.map((o) => o.id), (offerId, update) => {
      setOffers((prev) => prev.map((o) => (o.id === offerId ? { ...o, ...update } : o)))
    })
  }, [offers])

  useEffect(() => {
    if (activeTab !== 'transactions' || txLoaded) return
    getTransactionsBySeller()
      .then((data) => { setTransactions(data); setTxLoaded(true) })
      .catch(console.error)
  }, [activeTab, txLoaded])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (walletMenuRef.current && !walletMenuRef.current.contains(e.target as Node)) {
        setWalletMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!menuOpenId) return
    function handleClick(e: MouseEvent) {
      const wrap = menuWrapRefs.current[menuOpenId!]
      if (wrap && !wrap.contains(e.target as Node)) setMenuOpenId(null)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpenId])

  useEffect(() => {
    if (!cancelTarget || cancelCountdown <= 0) return
    const t = setTimeout(() => setCancelCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cancelTarget, cancelCountdown])

  async function handleSwitchRole() {
    const newRole = role === 'seller' ? 'buyer' : 'seller'
    const token = getAuthToken()
    if (!token || !walletAddress) return
    setSwitchingRole(true)
    try {
      await exchangeToken(token, walletAddress, newRole)
      setRole(newRole)
    } catch (err) {
      console.error('Failed to switch role', err)
    } finally {
      setSwitchingRole(false)
      setWalletMenuOpen(false)
    }
  }

  async function handleCreateOffer(
    name: string,
    description: string,
    priceLamports: number,
    quantity: number,
    unlimited: boolean,
  ) {
    if (!walletAddress) return
    setCreating(true)
    try {
      await registerSellerIfNew(walletAddress)
      const product = await getProduct(QR_PRODUCT_ID)
      const offer = await insertOffer(walletAddress, name, description, priceLamports, product.fee_bps, quantity, unlimited)
      setOffers((prev) => [offer, ...prev])
      setOfferModalOpen(false)
    } catch (err) {
      console.error('Failed to create offer', err)
    } finally {
      setCreating(false)
    }
  }

  async function handleTogglePause(offer: Offer, e: React.MouseEvent) {
    e.stopPropagation()
    setTogglingId(offer.id)
    try {
      if (offer.status === 'active') {
        await pauseOffer(offer.id)
        setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: 'paused' } : o)))
      } else {
        await resumeOffer(offer.id)
        setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: 'active' } : o)))
      }
    } catch (err) {
      console.error('Failed to toggle pause', err)
    } finally {
      setTogglingId(null)
    }
  }

  async function handleCancelClick(offer: Offer, e: React.MouseEvent) {
    e.stopPropagation()
    if (togglingId === offer.id) return
    cancelWasActiveRef.current = offer.status === 'active'
    if (offer.status === 'active') {
      setTogglingId(offer.id)
      try {
        await pauseOffer(offer.id)
        setOffers((prev) => prev.map((o) => (o.id === offer.id ? { ...o, status: 'paused' } : o)))
      } catch (err) {
        console.error('Failed to pause before cancel', err)
        setTogglingId(null)
        return
      }
      setTogglingId(null)
    }
    setCancelCountdown(10)
    setCancelTarget(offer)
  }

  async function handleCancelDismiss() {
    if (canceling) return
    if (cancelWasActiveRef.current && cancelTarget) {
      try {
        await resumeOffer(cancelTarget.id)
        setOffers((prev) => prev.map((o) => (o.id === cancelTarget.id ? { ...o, status: 'active' } : o)))
      } catch (err) {
        console.error('Failed to resume offer', err)
      }
    }
    setCancelTarget(null)
  }

  async function handleCancelConfirm() {
    if (!cancelTarget || canceling) return
    setCanceling(true)
    try {
      const activeForOffer = allCounterOffers.filter(
        (co) => co.offer_id === cancelTarget.id && co.status === 'active',
      )
      if (activeForOffer.length === 0) {
        await cancelOffer(cancelTarget.id)
        setOffers((prev) => prev.map((o) => (o.id === cancelTarget.id ? { ...o, status: 'canceled' } : o)))
        setCancelTarget(null)
        return
      }
      if (!primaryWallet || !isSolanaWallet(primaryWallet)) return
      const signer = await primaryWallet.getSigner()
      const anchorWallet = {
        publicKey: new PublicKey(primaryWallet.address),
        signTransaction: signer.signTransaction.bind(signer),
        signAllTransactions: signer.signAllTransactions.bind(signer),
      } as unknown as import('@solana/wallet-adapter-react').AnchorWallet
      await sellerCancelOffer(connection, anchorWallet, cancelTarget.id)
      setCancelTarget(null)
    } catch (err) {
      console.error('Failed to cancel offer', err)
      if (cancelTarget) {
        try {
          await resumeOffer(cancelTarget.id)
          setOffers((prev) => prev.map((o) => (o.id === cancelTarget.id ? { ...o, status: 'active' } : o)))
        } catch {
          // Best-effort rollback — if resuming also fails there's nothing more to do.
        }
      }
    } finally {
      setCanceling(false)
    }
  }

  async function handleHide(id: string) {
    try {
      await hideCounterOffer(id)
      setAllCounterOffers((prev) => prev.filter((co) => co.id !== id))
      setHiddenCount((c) => c + 1)
    } catch (err) {
      console.error('Failed to hide counter offer', err)
    }
  }

  async function handleUnhideAll() {
    try {
      await unhideAllCounterOffers()
      const { visible, hiddenCount } = await getCounterOffersBySeller()
      setAllCounterOffers(visible)
      setHiddenCount(hiddenCount)
    } catch (err) {
      console.error('Failed to unhide all counter offers', err)
    }
  }

  async function handleAccept(id: string) {
    if (!primaryWallet || !isSolanaWallet(primaryWallet)) return
    if (acceptingRef.current) return
    acceptingRef.current = true
    setAccepting(true)
    try {
      const signer = await primaryWallet.getSigner()
      const anchorWallet = {
        publicKey: new PublicKey(primaryWallet.address),
        signTransaction: signer.signTransaction.bind(signer),
        signAllTransactions: signer.signAllTransactions.bind(signer),
      } as unknown as import('@solana/wallet-adapter-react').AnchorWallet
      await acceptCounter(connection, anchorWallet, [id])
      // The accept tx is confirmed on chain; settlement (and the realtime
      // status flip to `confirmed`) follows within seconds via the backend.
      // Remove the row optimistically so the Accept button doesn't reappear
      // during that gap — a refresh would resurface it if settlement stalled.
      setAllCounterOffers((prev) => prev.filter((co) => co.id !== id))
    } catch (err) {
      console.error('Accept failed', err)
    } finally {
      acceptingRef.current = false
      setAccepting(false)
    }
  }

  async function handleDownloadQr(offer: Offer, e: React.MouseEvent) {
    e.stopPropagation()
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
          svg = svg.replace(
            '</svg>',
            `<image href="${logoData}" x="${x}" y="${y}" width="${logoSize}" height="${logoSize}"/></svg>`,
          )
        }
      }
    } catch {
      /* download without logo if fetch fails */
    }
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

  function formatDate(iso: string) {
    const d = new Date(iso)
    return `${d.getDate().toString().padStart(2, '0')}.${(d.getMonth() + 1).toString().padStart(2, '0')}.${d.getFullYear()}`
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }

  function shortWallet(addr: string) {
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`
  }

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : null

  const canAct = (o: Offer) => o.status === 'active' || o.status === 'paused'
  const activeCoCount = allCounterOffers.length

  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={s.logo}>
          <img src="/favicon.svg" alt="" className={s.logoIcon} />
          <span className={s.logoWordmark}>arcpay</span>
        </div>
        <div className={s.headerActions}>
          {shortAddress && (
            <div className={s.walletMenu} ref={walletMenuRef}>
              <button
                className={s.walletButton}
                onClick={() => setWalletMenuOpen((o) => !o)}
                title={walletAddress}
              >
                <span className={s.walletRoleBadge}>{role}</span>
                {shortAddress}
              </button>
              {walletMenuOpen && (
                <div className={s.walletDropdown}>
                  <button
                    className={s.walletDropdownItem}
                    onClick={() => { navigator.clipboard.writeText(walletAddress!); setWalletMenuOpen(false) }}
                  >
                    Copy address
                  </button>
                  <button
                    className={s.walletDropdownItem}
                    onClick={handleSwitchRole}
                    disabled={switchingRole}
                  >
                    {switchingRole ? 'Switching…' : `Switch to ${role === 'seller' ? 'buyer' : 'seller'}`}
                  </button>
                </div>
              )}
            </div>
          )}
          <button className={s.signOutButton} onClick={() => signOutUser()}>
            Sign out
          </button>
        </div>
      </header>

      <main className={s.content}>
        {/* QR Offers grid */}
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
              {offers.map((offer) => {
                const offerCoCount = allCounterOffers.filter((co) => co.offer_id === offer.id).length
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
                            <p className={s.offerDescription}>{offer.description}</p>
                          )}
                        </div>
                        <span className={`${s.statusBadge} ${statusClass(offer.status)}`}>
                          {offer.status}
                        </span>
                      </div>
                      <div className={s.offerCardBottom} onClick={(e) => e.stopPropagation()}>
                        <div className={s.offerCardPrice}>
                          <SolIcon />
                          <span>{(offer.price_lamports / 1e9).toFixed(4)} SOL</span>
                        </div>
                        <span className={`${s.offerCardPill} ${s.offerCardAvailPill}`}>
                          {offer.unlimited
                            ? 'Unlimited'
                            : `${offer.quantity - offer.quantity_sold} of ${offer.quantity} Available`}
                        </span>
                        <span className={s.offerCardPill}>{offerCoCount} Offers</span>
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
                            ref={(el) => { menuWrapRefs.current[offer.id] = el }}
                          >
                            <button
                              className={s.offerCardIconBtn}
                              onClick={() => setMenuOpenId((p) => (p === offer.id ? null : offer.id))}
                            >
                              <MenuIcon />
                            </button>
                            {menuOpenId === offer.id && (
                              <div className={s.offerCardMenuDropdown}>
                                <button
                                  className={s.offerCardMenuDropdownItem}
                                  disabled={togglingId === offer.id}
                                  onClick={(e) => { setMenuOpenId(null); handleTogglePause(offer, e) }}
                                >
                                  {offer.status === 'active' ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
                                  {togglingId === offer.id
                                    ? offer.status === 'active' ? 'Pausing…' : 'Resuming…'
                                    : offer.status === 'active' ? 'Pause' : 'Resume'}
                                </button>
                                <button
                                  className={s.offerCardMenuDropdownItem}
                                  disabled={togglingId === offer.id}
                                  onClick={(e) => { setMenuOpenId(null); handleCancelClick(offer, e) }}
                                >
                                  <CloseIcon size={16} />
                                  Cancel
                                </button>
                                <button
                                  className={s.offerCardMenuDropdownItem}
                                  onClick={(e) => { setMenuOpenId(null); handleDownloadQr(offer, e) }}
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
                )
              })}
            </div>
          )}
        </section>

        {/* Tabbed counter offers + transactions */}
        <section className={s.bottomPanel}>
          <div className={s.tabsRow}>
            <div className={s.tabGroup}>
              <button
                className={`${s.tabBtn} ${activeTab === 'counteroffers' ? s.tabBtnActive : ''}`}
                onClick={() => setActiveTab('counteroffers')}
              >
                {activeCoCount > 0 && <span className={s.tabBadge}>{activeCoCount}</span>}
                Active offers
              </button>
              <button
                className={`${s.tabBtn} ${activeTab === 'transactions' ? s.tabBtnActive : ''}`}
                onClick={() => setActiveTab('transactions')}
              >
                Transactions
              </button>
            </div>
            {activeTab === 'counteroffers' && (
              <button
                className={s.unhideAllBtn}
                onClick={handleUnhideAll}
                disabled={hiddenCount === 0}
              >
                Show hidden{hiddenCount > 0 ? ` (${hiddenCount})` : ''}
              </button>
            )}
          </div>

          {activeTab === 'counteroffers' && (
            <div className={s.coList}>
              {allCounterOffers.length === 0 ? (
                <p className={s.offersEmpty}>No active counter offers.</p>
              ) : (
                allCounterOffers.map((co) => {
                  const profitLamports = co.seller_amount
                  const offerName = offers.find((o) => o.id === co.offer_id)?.name ?? ''
                  return (
                    <div key={co.id} className={s.coListRow}>
                      <div className={s.coListName}>
                        <div className={s.coListOfferIcon}>
                          <img src="/favicon.svg" alt="" />
                        </div>
                        <span className={s.coListValue}>{offerName}</span>
                      </div>
                      <div className={s.coListCol}>
                        <span className={s.coListLabel}>From wallet</span>
                        <span className={s.coListValue}>{shortWallet(co.buyer_wallet)}</span>
                      </div>
                      <div className={s.coListCol}>
                        <span className={s.coListLabel}>{formatDate(co.created_at)}</span>
                        <span className={s.coListValue}>{formatTime(co.created_at)}</span>
                      </div>
                      <div className={s.coListCol}>
                        <span className={s.coListLabel}>Expire on</span>
                        <span className={s.coListValue}>{formatDate(co.expiry_at)}</span>
                      </div>
                      <div className={s.coListCol}>
                        <span className={s.coListLabel}>Profit</span>
                        <span className={s.coListValue}>{(profitLamports / 1e9).toFixed(4)} SOL</span>
                      </div>
                      <span className={s.coListValueBold}>
                        {((co.seller_amount + co.fee_amount) / 1e9).toFixed(4)} SOL
                      </span>
                      <span className={`${s.statusBadge} ${s.statusActive}`}>active</span>
                      <div className={s.coListActions}>
                        <button className={s.hideOfferBtn} onClick={() => handleHide(co.id)}>
                          Hide
                        </button>
                        <button
                          className={s.acceptOfferBtn}
                          disabled={accepting}
                          onClick={() => handleAccept(co.id)}
                        >
                          {accepting ? 'Accepting…' : 'Accept'}
                        </button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className={s.coList}>
              {!txLoaded ? (
                <p className={s.offersEmpty}>Loading…</p>
              ) : transactions.length === 0 ? (
                <p className={s.offersEmpty}>No transactions yet.</p>
              ) : (
                transactions.map((tx) => (
                  <div key={tx.id} className={s.coListRow}>
                    <div className={s.coListName}>
                      <div className={s.coListOfferIcon}>
                        <img src="/favicon.svg" alt="" />
                      </div>
                      <span className={s.coListValue}>{tx.offer_name}</span>
                    </div>
                    <div className={s.coListCol}>
                      <span className={s.coListLabel}>From wallet</span>
                      <span className={s.coListValue}>{shortWallet(tx.buyer_wallet)}</span>
                    </div>
                    <div className={s.coListCol}>
                      <span className={s.coListLabel}>{formatDate(tx.created_at)}</span>
                      <span className={s.coListValue}>{formatTime(tx.created_at)}</span>
                    </div>
                    <div className={s.coListCol}>
                      <span className={s.coListLabel}>Fee</span>
                      <span className={s.coListValue}>
                        {tx.fee_amount > 0 ? `${(tx.fee_amount / 1e9).toFixed(4)} SOL` : '—'}
                      </span>
                    </div>
                    <span className={s.coListValueBold}>
                      {(tx.seller_amount / 1e9).toFixed(4)} SOL
                    </span>
                    <div className={s.coListSourceSlot}>
                      <span
                        className={`${s.coListSourceBadge} ${
                          tx.source === 'buy' ? s.coListSourceBuy : s.coListSourceCounter
                        }`}
                      >
                        {tx.source === 'buy' ? 'direct buy' : 'offer'}
                      </span>
                    </div>
                    <div className={s.coListStatusSlot}>
                      <span className={`${s.statusBadge} ${s.statusConfirmed}`}>confirmed</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </section>
      </main>

      {cancelTarget && (
        <div className={s.modalOverlay}>
          <div className={s.modal}>
            <h2 className={s.modalTitle}>Cancel offer</h2>
            <p className={s.offersEmpty}>
              Cancel &ldquo;{cancelTarget.name}&rdquo;? Active counter offers will be refunded on-chain.
            </p>
            <div className={s.modalActions}>
              <button className={s.modalCancelButton} onClick={handleCancelDismiss} disabled={canceling}>
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
                    ? 'Canceling…'
                    : 'Confirm cancel'}
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
      />
    </div>
  )
}
