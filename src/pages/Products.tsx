import { useEffect, useState } from 'react'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { getOffersByWallet, watchOfferStatuses } from '../supabase/offers/offers'
import {
  getCounterOffersBySeller,
  watchNewCounterOffers,
} from '../supabase/offers/getCounterOffers'
import type { Offer } from '../types/offer'
import type { CounterOffer } from '../types/counterOffer'
import AppHeader from '../components/AppHeader'
import ProductsGrid from '../components/ProductsGrid'
import s from '../styles/dashboard.module.css'

export default function Products() {
  const { primaryWallet } = useDynamicContext()
  const walletAddress = primaryWallet?.address

  const [offers, setOffers] = useState<Offer[]>([])
  const [counterOffers, setCounterOffers] = useState<CounterOffer[]>([])

  useEffect(() => {
    if (!walletAddress) return
    getOffersByWallet(walletAddress).then(setOffers).catch(console.error)
  }, [walletAddress])

  const ownOfferIdKey = offers.map((o) => o.id).join(',')
  useEffect(() => {
    const ids = ownOfferIdKey ? ownOfferIdKey.split(',') : []
    getCounterOffersBySeller(ids)
      .then(({ visible }) => setCounterOffers(visible))
      .catch(console.error)
  }, [ownOfferIdKey])

  useEffect(() => {
    const ids = ownOfferIdKey ? ownOfferIdKey.split(',') : []
    if (ids.length === 0) return
    return watchOfferStatuses(ids, (offerId, update) => {
      setOffers((prev) => prev.map((o) => (o.id === offerId ? { ...o, ...update } : o)))
    })
  }, [ownOfferIdKey])

  // Keep each card's "N Offers" badge live as new counter offers land.
  useEffect(() => {
    const ids = ownOfferIdKey ? ownOfferIdKey.split(',') : []
    if (ids.length === 0) return
    const unsubs = ids.map((id) =>
      watchNewCounterOffers(id, (co) => {
        setCounterOffers((prev) =>
          prev.some((c) => c.id === co.id) ? prev : [co, ...prev],
        )
      }),
    )
    return () => unsubs.forEach((u) => u())
  }, [ownOfferIdKey])

  return (
    <div className={s.page}>
      <AppHeader />
      <main className={s.content}>
        <ProductsGrid
          title="Products for sale"
          offers={offers}
          setOffers={setOffers}
          counterOffers={counterOffers}
          initialVisible={20}
          paginate
        />
      </main>
    </div>
  )
}
