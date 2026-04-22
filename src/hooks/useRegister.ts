import { useState } from 'react'
import { useWallet, useAnchorWallet } from '@solana/wallet-adapter-react'
import { connection } from '../solana/connection'
import { register as solanaRegister } from '../solana/instructions/register'

export function useRegister() {
  const { connected, sendTransaction } = useWallet()
  const anchorWallet = useAnchorWallet()
  const [registering, setRegistering] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function register(): Promise<string | null> {
    if (!anchorWallet || !connected) return null
    setRegistering(true)
    setError(null)
    try {
      const signature = await solanaRegister(connection, anchorWallet, sendTransaction)
      return signature
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
      return null
    } finally {
      setRegistering(false)
    }
  }

  return { register, registering, error, connected }
}
