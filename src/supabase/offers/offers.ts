import { supabase } from '../client'
import type { Offer } from '../../types/offer'
import type { OfferDetail } from '../../types/offerDetail'

export async function insertOffer(
  userId: string,
  sellerWallet: string,
  name: string,
  description: string,
  priceLamports: number,
): Promise<Offer> {
  const { data: offer, error: offerError } = await supabase
    .from('qr_offers_data')
    .insert({ name, description, price_lamports: priceLamports })
    .select()
    .single()
  if (offerError) throw offerError

  const { error: sellerError } = await supabase
    .from('qr_offers_sellers')
    .insert({ offer_id: offer.id, user_id: userId, seller_wallet: sellerWallet })
  if (sellerError) throw sellerError

  return offer
}

export async function getOffer(offerId: string): Promise<OfferDetail | null> {
  const { data, error } = await supabase
    .from('qr_offers_data')
    .select('*, qr_listings(*)')
    .eq('id', offerId)
    .maybeSingle()
  if (error) throw error
  return data as OfferDetail | null
}

export function watchOfferStatus(
  offerId: string,
  onStatus: (status: string) => void,
): () => void {
  const channel = supabase
    .channel(`offer-status-${offerId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'qr_offers_data',
        filter: `id=eq.${offerId}`,
      },
      (payload) => {
        const status = (payload.new as { status?: string }).status
        if (status) onStatus(status)
      },
    )
    .subscribe()

  return () => channel.unsubscribe()
}

export async function getOffersByUser(userId: string): Promise<OfferDetail[]> {
  const { data, error } = await supabase
    .from('qr_offers_sellers')
    .select('qr_offers_data(*, qr_listings(*))')
    .eq('user_id', userId)
  if (error) throw error
  return data.map((row) => row.qr_offers_data as unknown as OfferDetail)
}
