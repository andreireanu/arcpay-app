import { supabase } from '../client'

export interface AcceptCounterAuth {
  ephemeralUuid: string
  signature: string
  expiry: number
  backendPublicKey: string
}

export async function getAcceptCounterAuth(
  counterOfferIds: string[],
  sellerWallet: string,
): Promise<AcceptCounterAuth> {
  // invoke() attaches the logged-in seller's bearer token, so the function can
  // run with JWT verification on (only authenticated sellers may request a
  // signature). The signing logic still binds to the seller's wallet on-chain.
  const { data, error } = await supabase.functions.invoke('seller-authorize', {
    body: { counter_offer_ids: counterOfferIds, seller_wallet: sellerWallet },
  })
  if (error) throw error
  return data as AcceptCounterAuth
}
