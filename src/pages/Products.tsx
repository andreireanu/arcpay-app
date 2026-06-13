import { useEffect, useState } from 'react'
import { useDynamicContext } from '@dynamic-labs/sdk-react-core'
import { getOffersByWallet, watchOfferStatuses } from '../supabase/offers/offers'
import { getCounterOffersBySeller } from '../supabase/offers/getCounterOffers'
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

  useEffect(() => {
    getCounterOffersBySeller()
      .then(({ visible }) => setCounterOffers(visible))
      .catch(console.error)
  }, [])

  useEffect(() => {
    if (offers.length === 0) return
    return watchOfferStatuses(offers.map((o) => o.id), (offerId, update) => {
      setOffers((prev) => prev.map((o) => (o.id === offerId ? { ...o, ...update } : o)))
    })
  }, [offers])

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
