import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { useConnection } from '@solana/wallet-adapter-react'
import {
  getItemsBought,
  getBuyerActiveCounterOffers,
} from '../supabase/buyers/buyerData'
import { getOffersByIds, getOffer } from '../supabase/offers/offers'
import { watchCounterOfferStatuses } from '../supabase/offers/getCounterOffers'
import {
  getTransactionsByBuyer,
  getCanceledOffersByBuyer,
  watchBuyerTransactions,
} from '../supabase/transactions/transactions'
import { cancelCounterOfferAction } from '../dispatcher/actions'
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

  const [activeTab, setActiveTab] = useState<'active' | 'transactions' | 'past'>('active')
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txLoaded, setTxLoaded] = useState(false)
  // Bumped to force a Transactions re-fetch when a counter offer settles (those
  // don't arrive via the qr_transactions live subscription).
  const [txReload, setTxReload] = useState(0)
  const [pastOffers, setPastOffers] = useState<Transaction[]>([])
  const [pastLoaded, setPastLoaded] = useState(false)
  const [cancelingId, setCancelingId] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
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

  // A filter change is user-driven, so show the loading state rather than the
  // previous item's rows. A txReload bump is a background refresh and keeps the
  // current rows visible (no flag reset here).
  useEffect(() => {
    setTxLoaded(false)
  }, [focusedOfferId])

  // Don't carry a stale cancel error across tab navigations.
  useEffect(() => {
    setCancelError(null)
  }, [activeTab])

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
  }, [walletAddress, focusedOfferId, txReload])

  // Live: a new buy by this wallet lands in qr_transactions.
  useEffect(() => {
    if (!walletAddress) return
    return watchBuyerTransactions(walletAddress, (row) => {
      // Don't inject a buy for a different item while the list is filtered.
      const focus = focusedOfferIdRef.current
      if (focus && row.offer_id !== focus) return
      const cachedName = offerNamesRef.current[row.offer_id]
      setTransactions((prev) => {
        if (prev.some((t) => t.id === row.id)) return prev
        return [{ ...row, offer_name: cachedName ?? '', source: 'buy' as const }, ...prev]
      })
      setTxTotal((c) => c + 1)
      // The realtime row carries no offer_name; if it isn't cached (e.g. a buy
      // for an item not in this dashboard's offers), fetch it and patch the row
      // so the name isn't left blank.
      if (!cachedName) {
        getOffer(row.offer_id)
          .then((offer) => {
            if (!offer?.name) return
            offerNamesRef.current[row.offer_id] = offer.name
            setTransactions((prev) =>
              prev.map((t) =>
                t.id === row.id ? { ...t, offer_name: offer.name } : t,
              ),
            )
          })
          .catch(console.error)
      }
    })
  }, [walletAddress])

  // Canceled offers (by either party). Loaded lazily when the tab opens.
  useEffect(() => {
    if (activeTab !== 'past' || pastLoaded || !walletAddress) return
    getCanceledOffersByBuyer(walletAddress)
      .then((rows) => { setPastOffers(rows); setPastLoaded(true) })
      .catch(console.error)
  }, [activeTab, pastLoaded, walletAddress])

  // Live: one of the buyer's counter offers gets confirmed (becomes a purchase)
  // or canceled — drop it from Active and refresh the purchase-derived views.
  const coIdKey = counterOffers.map((co) => co.id).join(',')
  useEffect(() => {
    if (!coIdKey) return
    return watchCounterOfferStatuses(coIdKey.split(','), (id, status) => {
      if (status === 'active') return
      setCounterOffers((prev) => prev.filter((co) => co.id !== id))
      if (status === 'confirmed' || status === 'auto_confirmed') {
        if (walletAddress) getItemsBought(walletAddress).then(setItems).catch(console.error)
        setTxReload((n) => n + 1)
      } else {
        // buyer_canceled / seller_canceled → refetch Canceled offers next open.
        setPastLoaded(false)
      }
    })
  }, [coIdKey, walletAddress])

  async function handleCancel(counterOffer: CounterOffer) {
    if (!primaryWallet || cancelingRef.current) return
    cancelingRef.current = true
    setCancelingId(counterOffer.id)
    setCancelError(null)
    try {
      await cancelCounterOfferAction(primaryWallet, connection, counterOffer)
      setCounterOffers((prev) => prev.filter((co) => co.id !== counterOffer.id))
    } catch (err) {
      console.error('Failed to cancel counter offer', err)
      setCancelError('Could not cancel that offer. Please try again.')
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
  const shownPastOffers = focusedOfferId
    ? pastOffers.filter((t) => t.offer_id === focusedOfferId)
    : pastOffers
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
              <button
                className={`${s.tabBtn} ${activeTab === 'past' ? s.tabBtnActive : ''}`}
                onClick={() => setActiveTab('past')}
              >
                Canceled offers
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
              <>
                {cancelError && <p className={s.errorMessage}>{cancelError}</p>}
                <CounterOffersList
                  counterOffers={shownCounterOffers}
                  onCancel={handleCancel}
                  cancelingId={cancelingId}
                  offerNameFor={(offerId) => offerNames[offerId] ?? ''}
                />
              </>
            ))}

          {activeTab === 'transactions' && (
            <>
              <TransactionsList
                transactions={transactions.slice(0, 5)}
                loading={!txLoaded}
                walletLabel="Your wallet"
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

          {activeTab === 'past' && (
            shownPastOffers.length === 0 && pastLoaded ? (
              <p className={s.offersEmpty}>No canceled offers.</p>
            ) : (
              <TransactionsList transactions={shownPastOffers} loading={!pastLoaded} walletLabel="Your wallet" />
            )
          )}
        </section>
      </main>
    </div>
  )
}
