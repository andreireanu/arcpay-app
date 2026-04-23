import { supabase } from '../client'

export interface RegistrationAuth {
  signature: Uint8Array    // 64 bytes — ed25519 signature from backend
  expiry: number           // unix timestamp
  backendPublicKey: string // base58 — backend pubkey stored in Config on-chain
  uuidBytes: Uint8Array    // 16 bytes — Supabase user UUID
}

export async function getRegistrationAuth(wallet: string): Promise<RegistrationAuth> {
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session
  if (!session) throw new Error('Not authenticated')
  const userId = session.user.id

  const { data, error } = await supabase.functions.invoke('sol-authorize', {
    body: { wallet },
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  if (error) throw error

  const signature = Uint8Array.from(atob(data.signature), (c) => c.charCodeAt(0))

  const uuidHex = userId.replace(/-/g, '')
  const uuidBytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) {
    uuidBytes[i] = parseInt(uuidHex.slice(i * 2, i * 2 + 2), 16)
  }

  return {
    signature,
    expiry: data.expiry,
    backendPublicKey: data.backendPublicKey,
    uuidBytes,
  }
}
