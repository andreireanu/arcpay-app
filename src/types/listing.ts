import type { Offer } from './offer'

export interface Listing {
  offer_id: string
  listing_pda: string
  qr_url: string | null
  created_at: string
  offer?: Offer
}
