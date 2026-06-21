import { supabase } from '../client'

export interface BuyAuth {
  signature: Uint8Array
  expiry: number
  backendPublicKey: string
  sellerAmount: number
  feeAmount: number
  sellerWallet: string
}

export async function getBuyAuth(offerId: string, buyerWallet: string): Promise<BuyAuth> {
  const { data, error } = await supabase.functions.invoke('buy-authorize', {
    body: { offer_id: offerId, buyer_wallet: buyerWallet },
  })
  if (error) {
    // supabase-js wraps a non-2xx as FunctionsHttpError and hides the response
    // body; read it so the real error (e.g. a missing secret) surfaces.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.text === 'function') {
      const body = await ctx.text().catch(() => '')
      if (body) throw new Error(`buy-authorize: ${body}`)
    }
    throw error
  }

  return {
    signature: Uint8Array.from(atob(data.signature), (c) => c.charCodeAt(0)),
    expiry: data.expiry,
    backendPublicKey: data.backendPublicKey,
    sellerAmount: data.sellerAmount,
    feeAmount: data.feeAmount,
    sellerWallet: data.sellerWallet,
  }
}
