import { supabase } from '../client'
import type { Offer } from '../../types/offer'

export async function insertOffer(
  sellerWallet: string,
  name: string,
  description: string,
  priceLamports: number,
  feeBps: number,
): Promise<Offer> {
  const { data: offer, error } = await supabase
    .from('qr_offers')
    .insert({ name, description, price_lamports: priceLamports, seller_wallet: sellerWallet, fee_bps: feeBps })
    .select()
    .single()
  if (error) throw error
  return offer
}

export async function getOffer(offerId: string): Promise<Offer | null> {
  const { data, error } = await supabase
    .from('qr_offers')
    .select('*')
    .eq('id', offerId)
    .maybeSingle()
  if (error) throw error
  return data as Offer | null
}

export async function getOffersByWallet(sellerWallet: string): Promise<Offer[]> {
  const { data, error } = await supabase
    .from('qr_offers')
    .select('*')
    .eq('seller_wallet', sellerWallet)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as Offer[]
}

export async function pauseOffer(offerId: string): Promise<void> {
  const { data, error } = await supabase
    .from('qr_offers')
    .update({ status: 'paused' })
    .eq('id', offerId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Update blocked by server')
}

export async function resumeOffer(offerId: string): Promise<void> {
  const { data, error } = await supabase
    .from('qr_offers')
    .update({ status: 'active' })
    .eq('id', offerId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Update blocked by server')
}

export async function cancelOffer(offerId: string): Promise<void> {
  const { data, error } = await supabase
    .from('qr_offers')
    .update({ status: 'canceled' })
    .eq('id', offerId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Update blocked by server')
}

export function watchOfferStatuses(
  offerIds: string[],
  onUpdate: (offerId: string, status: string) => void,
): () => void {
  if (offerIds.length === 0) return () => {}

  const channels = offerIds.map((id) =>
    supabase
      .channel(`offer-status-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'qr_offers', filter: `id=eq.${id}` },
        (payload) => {
          const status = (payload.new as { status?: string }).status
          if (status) onUpdate(id, status)
        },
      )
      .subscribe(),
  )

  return () => channels.forEach((c) => c.unsubscribe())
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
        table: 'qr_offers',
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
