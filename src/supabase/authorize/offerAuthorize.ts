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
  const { data, error } = await supabase.functions.invoke('sol-counteroffer-authorize', {
    body: { offer_id: offerId, buyer_wallet: buyerWallet, amount_lamports: amountLamports },
  })
  if (error) throw error
  return data as OfferAuth
}
