import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { useConnection } from '@solana/wallet-adapter-react'
import { getOffersByWallet, watchOfferStatuses } from '../supabase/offers/offers'
import {
  getCounterOffersBySeller,
  hideCounterOffers,
  unhideAllCounterOffers,
  watchNewCounterOffers,
  watchCounterOfferStatuses,
} from '../supabase/offers/getCounterOffers'
import { getTransactionsBySeller, watchNewTransactions, watchSettledCounterOffers } from '../supabase/transactions/transactions'
import { acceptCounterOffers } from '../dispatcher/actions'
import type { Offer } from '../types/offer'
import type { CounterOffer } from '../types/counterOffer'
import type { Transaction } from '../types/transaction'
import { useTrackPageView } from '../analytics/gtag'
import AppHeader from '../components/AppHeader'
import ProductsGrid from '../components/ProductsGrid'
import TransactionsList from '../components/TransactionsList'
import CounterOffersList from '../components/CounterOffersList'
import AlertModal from '../components/AlertModal'
import s from '../styles/dashboard.module.css'

export default function SellerDashboard() {
  const { primaryWallet } = useDynamicContext()
  const { connection } = useConnection()
  const navigate = useNavigate()
  const walletAddress = primaryWallet?.address

  useTrackPageView('seller')

  const [offers, setOffers] = useState<Offer[]>([])
  // Latest offers for realtime callbacks that resolve an offer name, so the
  // subscriptions below can key on the id set (not the array reference) without
  // capturing a stale list.
  const offersRef = useRef(offers)
  offersRef.current = offers

  const [activeTab, setActiveTab] = useState<'counteroffers' | 'transactions'>('counteroffers')
  const [allCounterOffers, setAllCounterOffers] = useState<CounterOffer[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [txTotal, setTxTotal] = useState(0)
  const [txLoaded, setTxLoaded] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [acceptError, setAcceptError] = useState<string | null>(null)
  const acceptingRef = useRef(false)

  useEffect(() => {
    if (!walletAddress) return
    getOffersByWallet(walletAddress).then(setOffers).catch(console.error)
  }, [walletAddress])

  // Load counter offers received on the seller's OWN offers (not ones this
  // wallet placed as a buyer). Re-runs once the seller's offers have loaded.
  const ownOfferIdKey = offers.map((o) => o.id).join(',')
  useEffect(() => {
    const ids = ownOfferIdKey ? ownOfferIdKey.split(',') : []
    getCounterOffersBySeller(ids)
      .then(({ visible, hiddenCount }) => {
        setAllCounterOffers(visible)
        setHiddenCount(hiddenCount)
      })
      .catch(console.error)
  }, [ownOfferIdKey])

  useEffect(() => {
    const ids = ownOfferIdKey ? ownOfferIdKey.split(',') : []
    if (ids.length === 0) return
    const unsubs = ids.map((id) =>
      watchNewCounterOffers(id, (co) => {
        setAllCounterOffers((prev) => [co, ...prev])
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [ownOfferIdKey])

  useEffect(() => {
    const ids = ownOfferIdKey ? ownOfferIdKey.split(',') : []
    if (ids.length === 0) return
    const unsubs = ids.map((id) =>
      watchNewTransactions(id, (row) => {
        setTransactions((prev) => {
          if (prev.some((t) => t.id === row.id)) return prev
          const offer_name = offersRef.current.find((of) => of.id === row.offer_id)?.name ?? ''
          return [{ ...row, offer_name, source: 'buy' as const }, ...prev]
        })
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [ownOfferIdKey])

  useEffect(() => {
    const ids = ownOfferIdKey ? ownOfferIdKey.split(',') : []
    if (ids.length === 0) return
    const unsubs = ids.map((id) =>
      watchSettledCounterOffers(id, (row) => {
        setTransactions((prev) => {
          if (prev.some((t) => t.id === row.id)) return prev
          const offer_name = offersRef.current.find((of) => of.id === row.offer_id)?.name ?? ''
          return [{ ...row, offer_name }, ...prev]
        })
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [ownOfferIdKey])

  const coIdKey = allCounterOffers.map((co) => co.id).join(',')
  useEffect(() => {
    if (!coIdKey) return
    const ids = coIdKey.split(',')
    return watchCounterOfferStatuses(ids, (id, status) => {
      if (
        status === 'confirmed' ||
        status === 'auto_confirmed' ||
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
    const ids = ownOfferIdKey ? ownOfferIdKey.split(',') : []
    if (ids.length === 0) return
    return watchOfferStatuses(ids, (offerId, update) => {
      setOffers((prev) => prev.map((o) => (o.id === offerId ? { ...o, ...update } : o)))
    })
  }, [ownOfferIdKey])

  useEffect(() => {
    if (activeTab !== 'transactions' || txLoaded || !walletAddress) return
    getTransactionsBySeller(walletAddress, 0, 5)
      .then(({ transactions, total }) => { setTransactions(transactions); setTxTotal(total); setTxLoaded(true) })
      .catch(console.error)
  }, [activeTab, txLoaded, walletAddress])

  async function handleHide(ids: string[]) {
    if (ids.length === 0) return
    try {
      await hideCounterOffers(ids)
      setAllCounterOffers((prev) => prev.filter((co) => !ids.includes(co.id)))
      setHiddenCount((c) => c + ids.length)
    } catch (err) {
      console.error('Failed to hide counter offers', err)
    }
  }

  async function handleUnhideAll() {
    try {
      await unhideAllCounterOffers()
      const { visible, hiddenCount } = await getCounterOffersBySeller(
        offers.map((o) => o.id),
      )
      setAllCounterOffers(visible)
      setHiddenCount(hiddenCount)
    } catch (err) {
      console.error('Failed to unhide all counter offers', err)
    }
  }

  async function handleAccept(ids: string[]) {
    if (!primaryWallet || ids.length === 0) return
    if (acceptingRef.current) return
    acceptingRef.current = true
    setAccepting(true)
    try {
      await acceptCounterOffers(primaryWallet, connection, ids)
      // The accept tx is confirmed on chain; settlement (and the realtime
      // status flip to `confirmed`) follows within seconds via the backend.
      // Remove the rows optimistically so the Accept button doesn't reappear
      // during that gap — a refresh would resurface them if settlement stalled.
      setAllCounterOffers((prev) => prev.filter((co) => !ids.includes(co.id)))
    } catch (err) {
      console.error('Accept failed', err)
      setAcceptError(
        err instanceof Error ? err.message : 'Could not accept these offers.',
      )
    } finally {
      acceptingRef.current = false
      setAccepting(false)
    }
  }

  const activeCoCount = allCounterOffers.length

  return (
    <div className={s.page}>
      <AppHeader />

      <main className={s.content}>
        <ProductsGrid
          title="Products for sale"
          offers={offers}
          setOffers={setOffers}
          counterOffers={allCounterOffers}
          initialVisible={6}
          onViewAll={() => navigate('/products')}
        />

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

          {activeTab === 'counteroffers' &&
            (allCounterOffers.length === 0 ? (
              <p className={s.offersEmpty}>No active counter offers.</p>
            ) : (
              <CounterOffersList
                counterOffers={allCounterOffers}
                accepting={accepting}
                onAccept={handleAccept}
                onHide={handleHide}
                offerNameFor={(offerId) =>
                  offers.find((o) => o.id === offerId)?.name ?? ''
                }
              />
            ))}

          {activeTab === 'transactions' && (
            <>
              <TransactionsList transactions={transactions.slice(0, 5)} loading={!txLoaded} />
              {txLoaded && (txTotal > 5 || transactions.length > 5) && (
                <div className={s.gridFooter}>
                  <button className={s.showMoreBtn} onClick={() => navigate('/transactions')}>
                    View all
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </main>

      <AlertModal
        message={acceptError}
        onClose={() => setAcceptError(null)}
        title="Can't accept"
      />
    </div>
  )
}
