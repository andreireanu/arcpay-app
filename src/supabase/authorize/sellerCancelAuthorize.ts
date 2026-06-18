import { supabase } from '../client'

export interface SellerCancelAuth {
  signature: string
  expiry: number
  backendPublicKey: string
  sellerWallet: string
}

export async function getSellerCancelAuth(
  offerId: string,
  sellerWallet: string,
): Promise<SellerCancelAuth> {
  // invoke() attaches the logged-in seller's bearer token so the function can
  // run with JWT verification on. seller-authorize signs the offer's own uuid
  // (cancel mode) once it confirms the offer belongs to this seller.
  const { data, error } = await supabase.functions.invoke('seller-authorize', {
    body: { offer_id: offerId, seller_wallet: sellerWallet },
  })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.text === 'function') {
      const body = await ctx.text().catch(() => '')
      if (body) throw new Error(`seller-authorize: ${body}`)
    }
    throw error
  }
  return data as SellerCancelAuth
}
