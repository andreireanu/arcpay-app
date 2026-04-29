import { useState } from 'react'
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react'
import { insertOffer } from '../supabase/offers/offers'
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
  ): Promise<Offer | null> {
    if (!anchorWallet || !connected) return null

    setCreating(true)
    setError(null)
    try {
      const offer = await insertOffer(
        anchorWallet.publicKey.toBase58(),
        name,
        description,
        priceLamports,
      )
      return offer
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create offer')
      return null
    } finally {
      setCreating(false)
    }
  }

  return { createListing, creating, error }
}
