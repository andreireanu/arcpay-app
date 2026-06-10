import { supabase } from '../client'

// Register the buyer when they initiate a buy or a counter offer. Inserts with
// confirmed = false (pending on-chain settlement); the corresponding webhook
// flips it to true once the tx lands. ON CONFLICT DO NOTHING so re-initiating
// never downgrades an already-confirmed buyer back to false. user_id is taken
// from the authenticated session — the only place it's available.
export async function registerBuyer(walletAddress: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')
  const { error } = await supabase
    .from('buyers')
    .upsert(
      { user_id: user.id, wallet_address: walletAddress, confirmed: false },
      { onConflict: 'wallet_address', ignoreDuplicates: true },
    )
  if (error) throw error
}
