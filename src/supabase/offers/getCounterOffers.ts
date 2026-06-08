import { supabase } from '../client'
import type { CounterOffer } from '../../types/counterOffer'

export async function getCounterOffersByOffer(offerId: string): Promise<CounterOffer[]> {
  const { data, error } = await supabase
    .from('qr_counteroffers')
    .select('*')
    .eq('offer_id', offerId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as CounterOffer[]
}

export function watchBuyerCounterOfferInsert(
  offerId: string,
  buyerWallet: string,
  onInsert: (counterOffer: CounterOffer) => void,
): () => void {
  const channel = supabase
    .channel(`counter-offer-buyer-${offerId}-${buyerWallet}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qr_counteroffers', filter: `offer_id=eq.${offerId}` },
      (payload) => {
        const row = payload.new as CounterOffer
        if (row.buyer_wallet === buyerWallet) onInsert(row)
      },
    )
    .subscribe()
  return () => channel.unsubscribe()
}

export function watchNewCounterOffers(
  offerId: string,
  onNew: (counterOffer: CounterOffer) => void,
): () => void {
  const channel = supabase
    .channel(`counter-offer-new-${offerId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'qr_counteroffers', filter: `offer_id=eq.${offerId}` },
      (payload) => onNew(payload.new as CounterOffer),
    )
    .subscribe()
  return () => channel.unsubscribe()
}

export function watchCounterOfferStatuses(
  counterOfferIds: string[],
  onUpdate: (id: string, status: CounterOffer['status']) => void,
): () => void {
  if (counterOfferIds.length === 0) return () => {}
  const channels = counterOfferIds.map((id) =>
    supabase
      .channel(`counter-offer-status-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'qr_counteroffers', filter: `id=eq.${id}` },
        (payload) => {
          const row = payload.new as Partial<CounterOffer>
          if (row.status !== undefined) onUpdate(id, row.status)
        },
      )
      .subscribe(),
  )
  return () => channels.forEach((c) => c.unsubscribe())
}

export async function getCounterOfferByBuyer(offerId: string, buyerWallet: string): Promise<CounterOffer | null> {
  const { data: { session } } = await supabase.auth.getSession()
  console.log('[getCounterOfferByBuyer] session app_metadata:', session?.user?.app_metadata ?? 'NO SESSION')
  console.log('[getCounterOfferByBuyer] querying', { offerId, buyerWallet })
  const { data, error } = await supabase
    .from('qr_counteroffers')
    .select('*')
    .eq('offer_id', offerId)
    .eq('buyer_wallet', buyerWallet)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  console.log('[getCounterOfferByBuyer] result', { data, error })
  if (error) throw error
  return data as CounterOffer | null
}
