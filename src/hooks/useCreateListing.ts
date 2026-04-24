import { useState } from 'react'
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react'
import { connection } from '../solana/connection'
import { getSession } from '../supabase/auth/auth'
import { insertOffer } from '../supabase/offers/offers'
import { waitForListing } from '../supabase/listings/realtime'
import type { Listing } from '../types/listing'
import type { Offer } from '../types/offer'

export function useCreateListing() {
  const { connected } = useWallet()
  const anchorWallet = useAnchorWallet()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createListing(
    name: string,
    description: string,
    priceLamports: number,
  ): Promise<{ offer: Offer; listing: Listing } | null> {
    if (!anchorWallet || !connected) return null

    const session = await getSession()
    if (!session) return null

    setCreating(true)
    setError(null)

    let cancel: (() => void) | null = null
    try {
      const offer = await insertOffer(
        session.user.id,
        anchorWallet.publicKey.toBase58(),
        name,
        description,
        priceLamports,
      )

      const { promise, cancel: cancelListener } = waitForListing(offer.id)
      cancel = cancelListener

      // TODO: send create_listing on-chain tx here

      const listing = await promise
      return { offer, listing }
    } catch (err) {
      cancel?.()
      setError(err instanceof Error ? err.message : 'Failed to create listing')
      return null
    } finally {
      setCreating(false)
    }
  }

  return { createListing, creating, error }
}
