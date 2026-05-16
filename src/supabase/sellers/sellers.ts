import { supabase } from '../client'

export async function isWalletRegistered(walletAddress: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('sellers')
    .select('id')
    .eq('wallet_address', walletAddress)
    .maybeSingle()
  if (error) throw error
  return data !== null
}

export async function registerSellerIfNew(walletAddress: string): Promise<void> {
  const already = await isWalletRegistered(walletAddress)
  if (already) return
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { error } = await supabase
    .from('sellers')
    .insert({ wallet_address: walletAddress, user_id: user.id })
  if (error) throw error
}
