import { useState } from 'react'
import { useAnchorWallet, useWallet } from '@solana/wallet-adapter-react'
import { insertOffer } from '../supabase/offers/offers'
import { getProduct } from '../supabase/products/products'
import type { Offer } from '../types/offer'

const QR_PRODUCT_ID = '2b78e60b-533d-469d-937e-aa462dc37c28'

export function useCreateListing() {
  const { connected } = useWallet()
  const anchorWallet = useAnchorWallet()
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function createListing(
    name: string,
    description: string,
    priceLamports: number,
    quantity: number,
  ): Promise<Offer | null> {
    if (!anchorWallet || !connected) return null

    setCreating(true)
    setError(null)
    try {
      const product = await getProduct(QR_PRODUCT_ID)
      const offer = await insertOffer(
        anchorWallet.publicKey.toBase58(),
        name,
        description,
        priceLamports,
        product.fee_bps,
        quantity,
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
