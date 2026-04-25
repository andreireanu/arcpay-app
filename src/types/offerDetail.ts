import type { Offer } from './offer'
import type { Listing } from './listing'

export interface OfferDetail extends Offer {
  qr_listings: Listing | null
}
