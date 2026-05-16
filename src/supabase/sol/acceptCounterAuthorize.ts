import { config } from '../../config/env'

export interface AcceptCounterAuth {
  ephemeralUuid: string
  signature: string
  expiry: number
  backendPublicKey: string
  totalAmount: number
}

export async function getAcceptCounterAuth(
  counterOfferIds: string[],
  sellerWallet: string,
): Promise<AcceptCounterAuth> {
  const res = await fetch(`${config.supabase.url}/functions/v1/sol-counter-authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': config.supabase.anonKey },
    body: JSON.stringify({ counter_offer_ids: counterOfferIds, seller_wallet: sellerWallet }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}
