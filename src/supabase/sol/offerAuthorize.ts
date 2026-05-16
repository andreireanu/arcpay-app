import { config } from '../../config/env'

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
  const res = await fetch(`${config.supabase.url}/functions/v1/sol-offer-authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': config.supabase.anonKey },
    body: JSON.stringify({ offer_id: offerId, buyer_wallet: buyerWallet, amount_lamports: amountLamports }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
