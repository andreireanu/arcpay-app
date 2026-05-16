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
  const { data, error } = await supabase.functions.invoke('sol-buy-authorize', {
    body: { offer_id: offerId, buyer_wallet: buyerWallet },
  })
  if (error) throw error

  return {
    signature: Uint8Array.from(atob(data.signature), (c) => c.charCodeAt(0)),
    expiry: data.expiry,
    backendPublicKey: data.backendPublicKey,
    sellerAmount: data.sellerAmount,
    feeAmount: data.feeAmount,
    sellerWallet: data.sellerWallet,
  }
}
