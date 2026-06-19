import { supabase } from '../client'
import type { CounterOffer } from '../../types/counterOffer'
import type { Offer } from '../../types/offer'
import { getOffersByIds } from '../offers/offers'

// "Items bought": the distinct offers this wallet has a *confirmed* purchase on —
// either a settled direct buy or an accepted (confirmed) counter offer. Pulled
// from the qr_seller_transactions view (buys + confirmed counter offers),
// scoped explicitly to buyer_wallet — NOT by RLS, since a wallet that also sells
// would otherwise match its seller-received rows too. Resolved to full offer
// rows so the cards can show stock + status.
export async function getItemsBought(buyerWallet: string): Promise<Offer[]> {
  const { data, error } = await supabase
    .from('qr_seller_transactions')
    .select('offer_id, created_at')
    .eq('buyer_wallet', buyerWallet)
    // Only real purchases count as "bought" — exclude canceled offer history.
    .in('status', ['confirmed', 'auto_confirmed'])
    .order('created_at', { ascending: false })
  if (error) throw error

  const seen = new Set<string>()
  const offerIds: string[] = []
  for (const row of (data ?? []) as { offer_id: string }[]) {
    if (!seen.has(row.offer_id)) {
      seen.add(row.offer_id)
      offerIds.push(row.offer_id)
    }
  }
  if (offerIds.length === 0) return []

  const offers = await getOffersByIds(offerIds)
  // Preserve recency order from the transactions query (getOffersByIds reorders).
  const byId = new Map(offers.map((o) => [o.id, o]))
  return offerIds.map((id) => byId.get(id)).filter((o): o is Offer => o != null)
}

// The buyer's still-pending counter offers (Active tab). Filter by buyer_wallet
// explicitly: qr_counteroffers also has a seller SELECT policy, so a wallet that
// is both buyer and seller would otherwise see counter offers received on its own
// offers here too.
export async function getBuyerActiveCounterOffers(
  buyerWallet: string,
): Promise<CounterOffer[]> {
  const { data, error } = await supabase
    .from('qr_counteroffers')
    .select('*')
    .eq('buyer_wallet', buyerWallet)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as CounterOffer[]
}
