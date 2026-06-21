import { supabase } from '../client'

export interface OfferAuth {
  ephemeralUuid: string
  signature: string
  expiry: number
  backendPublicKey: string
  sellerWallet: string
}

export async function getOfferAuth(
  offerId: string,
  buyerWallet: string,
  amountLamports: number,
): Promise<OfferAuth> {
  // invoke() attaches the bearer token so the function can run with JWT
  // verification on, matching the other authorize functions.
  const { data, error } = await supabase.functions.invoke('counteroffer-authorize', {
    body: { offer_id: offerId, buyer_wallet: buyerWallet, amount_lamports: amountLamports },
  })
  if (error) {
    // supabase-js wraps a non-2xx as FunctionsHttpError and hides the response
    // body; read it so the real error (e.g. a missing secret) surfaces.
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.text === 'function') {
      const body = await ctx.text().catch(() => '')
      if (body) throw new Error(`counteroffer-authorize: ${body}`)
    }
    throw error
  }
  return data as OfferAuth
}
