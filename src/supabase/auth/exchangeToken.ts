import { supabase } from '../client'
import { config } from '../../config/env'

export async function exchangeToken(
  dynamicToken: string,
  walletAddress: string,
  role: 'seller' | 'buyer' = 'seller',
): Promise<void> {
  const response = await fetch(
    `${config.supabase.url}/functions/v1/auth-exchange`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${dynamicToken}`,
      },
      body: JSON.stringify({ wallet_address: walletAddress, role }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`auth-exchange failed: ${text}`)
  }

  const { access_token, refresh_token } = await response.json()
  await supabase.auth.setSession({ access_token, refresh_token })
  localStorage.setItem('arcpay_role', role)
}
