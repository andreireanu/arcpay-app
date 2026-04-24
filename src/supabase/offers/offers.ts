import { supabase } from '../client'
import type { Offer } from '../../types/offer'

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

export async function getOffersByUser(userId: string): Promise<Offer[]> {
  const { data, error } = await supabase
    .from('qr_offers_sellers')
    .select('qr_offers_data(*)')
    .eq('user_id', userId)
  if (error) throw error
  return data.map((row) => row.qr_offers_data as unknown as Offer)
}
