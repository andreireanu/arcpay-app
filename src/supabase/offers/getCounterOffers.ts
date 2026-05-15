import { supabase } from '../client'
import type { CounterOffer } from '../../types/counterOffer'

export async function getCounterOffersByOffer(offerId: string): Promise<CounterOffer[]> {
  const { data, error } = await supabase
    .from('qr_counteroffers')
    .select('*')
    .eq('offer_id', offerId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as CounterOffer[]
}

export async function getCounterOfferByBuyer(offerId: string, buyerWallet: string): Promise<CounterOffer | null> {
  const { data: { session } } = await supabase.auth.getSession()
  console.log('[getCounterOfferByBuyer] session user_metadata:', session?.user?.user_metadata ?? 'NO SESSION')
  console.log('[getCounterOfferByBuyer] querying', { offerId, buyerWallet })
  const { data, error } = await supabase
    .from('qr_counteroffers')
    .select('*')
    .eq('offer_id', offerId)
    .eq('buyer_wallet', buyerWallet)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  console.log('[getCounterOfferByBuyer] result', { data, error })
  if (error) throw error
  return data as CounterOffer | null
}
