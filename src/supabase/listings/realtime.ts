import { supabase } from '../client'
import type { Listing } from '../../types/listing'

export function waitForListing(offerId: string): { promise: Promise<Listing>; cancel: () => void } {
  let resolve!: (listing: Listing) => void
  const promise = new Promise<Listing>((res) => { resolve = res })

  const channel = supabase
    .channel(`listing:${offerId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'qr_listings',
        filter: `offer_id=eq.${offerId}`,
      },
      (payload) => {
        channel.unsubscribe()
        resolve(payload.new as Listing)
      },
    )
    .subscribe()

  // Race guard: listing may already exist if webhook fired before subscription
  Promise.resolve(
    supabase.from('qr_listings').select('*').eq('offer_id', offerId).maybeSingle()
  ).then(({ data }) => {
    if (data) { channel.unsubscribe(); resolve(data as Listing) }
  }).catch(() => {})

  return {
    promise,
    cancel: () => channel.unsubscribe(),
  }
}
