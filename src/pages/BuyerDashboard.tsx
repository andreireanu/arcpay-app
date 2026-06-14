import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { isSolanaWallet } from '@dynamic-labs/solana-core'
import { useConnection } from '@solana/wallet-adapter-react'
import { PublicKey } from '@solana/web3.js'
import {
  getItemsBought,
  getBuyerActiveCounterOffers,
} from '../supabase/buyers/buyerData'
import { getOffersByIds } from '../supabase/offers/offers'
import { watchCounterOfferStatuses } from '../supabase/offers/getCounterOffers'
import {
  getTransactionsByBuyer,
  watchBuyerTransactions,
} from '../supabase/transactions/transactions'
import { cancelOffer } from '../solana/instructions/cancelOffer'
import type { Offer } from '../types/offer'
import type { CounterOffer } from '../types/counterOffer'
import type { Transaction } from '../types/transaction'
import AppHeader from '../components/AppHeader'
import ItemsBoughtGrid from '../components/ItemsBoughtGrid'
import TransactionsList from '../components/TransactionsList'
import CounterOffersList from '../components/CounterOffersList'
import s from '../styles/dashboard.module.css'

export default function BuyerDashboard() {
  const { primaryWallet } = useDynamicContext()
  const { connection } = useConnection()
  const navigate = useNavigate()
  const walletAddress = primaryWallet?.address

  const [items, setItems] = useState<Offer[]>([])
  const [counterOffers, setCounterOffers] = useState<CounterOffer[]>([])
  // Names for the offers behind counter offers (qr_counteroffers carries only
  // offer_id). Set from the async fetch below; merged with item names via memo.
  const [coOfferNames, setCoOfferNames] = useState<Record<string, string>>({})

  const [activeTab, setActiveTab] = useState<'active' | 'transactions'>('active')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txLoaded, setTxLoaded] = useState(false)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  // When set, both tabs are filtered to a single bought item (clicked above).
  const [focusedOfferId, setFocusedOfferId] = useState<string | null>(null)
  const cancelingRef = useRef(false)
  const tabsRef = useRef<HTMLElement>(null)
  const focusedOfferIdRef = useRef(focusedOfferId)
  focusedOfferIdRef.current = focusedOfferId

  // Items bought (confirmed purchases) — resolved to full offer cards.
  useEffect(() => {
    if (!walletAddress) return
    getItemsBought(walletAddress).then(setItems).catch(console.error)
  }, [walletAddress])

  // The buyer's pending counter offers (Active tab), plus the offer names behind
  // them (qr_counteroffers carries only offer_id).
  useEffect(() => {
    if (!walletAddress) return
    getBuyerActiveCounterOffers(walletAddress)
      .then(async (cos) => {
        setCounterOffers(cos)
        const ids = [...new Set(cos.map((co) => co.offer_id))]
        const offers = await getOffersByIds(ids)
        setCoOfferNames((prev) => {
          const next = { ...prev }
          for (const o of offers) next[o.id] = o.name
          return next
        })
      })
      .catch(console.error)
  }, [walletAddress])

  // Names for any offer we know about (bought items + counter offers), so live
  // rows and active-offer rows can resolve a label without an extra fetch.
  const offerNames = useMemo(() => {
    const map: Record<string, string> = { ...coOfferNames }
    for (const o of items) map[o.id] = o.name
    return map
  }, [items, coOfferNames])

  // Latest names for the realtime callback, so a new buy resolves a label
  // without making the subscription re-run each time the names map is
  // repopulated as items / counter-offer names finish loading.
  const offerNamesRef = useRef(offerNames)
  offerNamesRef.current = offerNames

  // Reloads whenever the focused item changes so the Transactions tab shows that
  // item's buys (not just whatever was in the latest unfiltered page).
  useEffect(() => {
    if (!walletAddress) return
    let cancelled = false
    getTransactionsByBuyer(walletAddress, 0, 5, focusedOfferId ?? undefined)
      .then(({ transactions, total }) => {
        if (cancelled) return
        setTransactions(transactions)
        setTxTotal(total)
        setTxLoaded(true)
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [walletAddress, focusedOfferId])

  // Live: a new buy by this wallet lands in qr_transactions.
  useEffect(() => {
    if (!walletAddress) return
    return watchBuyerTransactions(walletAddress, (row) => {
      // Don't inject a buy for a different item while the list is filtered.
      const focus = focusedOfferIdRef.current
      if (focus && row.offer_id !== focus) return
      setTransactions((prev) => {
        if (prev.some((t) => t.id === row.id)) return prev
        const offer_name = offerNamesRef.current[row.offer_id] ?? ''
        return [{ ...row, offer_name, source: 'buy' as const }, ...prev]
      })
      setTxTotal((c) => c + 1)
    })
  }, [walletAddress])

  // Live: one of the buyer's counter offers gets confirmed (becomes a purchase)
  // or canceled — drop it from Active and refresh the purchase-derived views.
  const coIdKey = counterOffers.map((co) => co.id).join(',')
  useEffect(() => {
    if (!coIdKey) return
    return watchCounterOfferStatuses(coIdKey.split(','), (id, status) => {
      if (status === 'active') return
      setCounterOffers((prev) => prev.filter((co) => co.id !== id))
      if (status === 'confirmed') {
        if (walletAddress) getItemsBought(walletAddress).then(setItems).catch(console.error)
        setTxLoaded(false)
      }
    })
  }, [coIdKey, walletAddress])

  async function handleCancel(ephemeralId: string, id: string) {
    if (!primaryWallet || !isSolanaWallet(primaryWallet) || cancelingRef.current)
      return
    cancelingRef.current = true
    setCancelingId(id)
    try {
      const signer = await primaryWallet.getSigner()
      const anchorWallet = {
        publicKey: new PublicKey(primaryWallet.address),
        signTransaction: signer.signTransaction.bind(signer),
        signAllTransactions: signer.signAllTransactions.bind(signer),
      } as unknown as import('@solana/wallet-adapter-react').AnchorWallet
      await cancelOffer(connection, anchorWallet, ephemeralId)
      setCounterOffers((prev) => prev.filter((co) => co.id !== id))
    } catch (err) {
      console.error('Failed to cancel counter offer', err)
    } finally {
      cancelingRef.current = false
      setCancelingId(null)
    }
  }

  function focusItem(offerId: string) {
    setFocusedOfferId(offerId)
    setActiveTab('transactions')
    tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const shownCounterOffers = focusedOfferId
    ? counterOffers.filter((co) => co.offer_id === focusedOfferId)
    : counterOffers
  const focusedName = focusedOfferId ? offerNames[focusedOfferId] ?? '' : ''

  return (
    <div className={s.page}>
      <AppHeader />

      <main className={s.content}>
        <ItemsBoughtGrid
          title="Items bought"
          offers={items}
          initialVisible={6}
          onItemClick={focusItem}
          selectedId={focusedOfferId}
        />

        <section className={s.bottomPanel} ref={tabsRef}>
          <div className={s.tabsRow}>
            <div className={s.tabGroup}>
              <button
                className={`${s.tabBtn} ${activeTab === 'active' ? s.tabBtnActive : ''}`}
                onClick={() => setActiveTab('active')}
              >
                {/* Always rendered so the badge reserves its space — the label
                    never shifts as the count appears/disappears. */}
                <span
                  className={`${s.tabBadge} ${shownCounterOffers.length === 0 ? s.tabBadgeHidden : ''}`}
                >
                  {shownCounterOffers.length}
                </span>
                Active offers
              </button>
              <button
                className={`${s.tabBtn} ${activeTab === 'transactions' ? s.tabBtnActive : ''}`}
                onClick={() => setActiveTab('transactions')}
              >
                Transactions
              </button>
            </div>
            {focusedOfferId && (
              <div className={s.filterChip}>
                <span className={s.filterChipLabel}>Filtered:</span>
                <span className={s.filterChipName}>{focusedName || 'item'}</span>
                <button
                  className={s.filterChipClear}
                  onClick={() => setFocusedOfferId(null)}
                  title="Clear filter"
                  aria-label="Clear filter"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {activeTab === 'active' &&
            (shownCounterOffers.length === 0 ? (
              <p className={s.offersEmpty}>No active offers.</p>
            ) : (
              <CounterOffersList
                counterOffers={shownCounterOffers}
                onCancel={handleCancel}
                cancelingId={cancelingId}
                offerNameFor={(offerId) => offerNames[offerId] ?? ''}
              />
            ))}

          {activeTab === 'transactions' && (
            <>
              <TransactionsList
                transactions={transactions.slice(0, 5)}
                loading={!txLoaded}
              />
              {txLoaded && txTotal > 5 && (
                <div className={s.gridFooter}>
                  <button
                    className={s.showMoreBtn}
                    onClick={() => navigate('/transactions')}
                  >
                    View all
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  )
}
