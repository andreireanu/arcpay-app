import { supabase } from './client'

export async function isWalletRegistered(walletAddress: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('qr_generator_sellers')
    .select('id')
    .eq('wallet_address', walletAddress)
    .maybeSingle()
  if (error) throw error
  return data !== null
}
