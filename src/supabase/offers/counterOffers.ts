import { supabase } from '../client'

export async function submitCounterOffer(
  offerId: string,
  buyerWallet: string,
  amountLamports: number,
): Promise<void> {
  const { error } = await supabase
    .from('counter_offers')
    .insert({ offer_id: offerId, buyer_wallet: buyerWallet, amount_lamports: amountLamports, status: 'pending' })
  if (error) throw error
}
