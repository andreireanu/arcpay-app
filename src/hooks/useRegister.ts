import { useState, useEffect } from 'react'
import { useWallet, useAnchorWallet } from '@solana/wallet-adapter-react'
import { connection } from '../solana/connection'
import { register as solanaRegister } from '../solana/instructions/register'
import { getRegisteredWallet } from '../supabase/sellers/sellers'
import { waitForRegistration } from '../supabase/sellers/realtime'
import { useAuth } from './useAuth'

export function useRegister() {
  const { session } = useAuth()
  const { connected } = useWallet()
  const anchorWallet = useAnchorWallet()
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [registeredWallet, setRegisteredWallet] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Intentionally depends on user ID, not the full session object — avoids re-running on token refresh
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setRegistered(false)
    setRegisteredWallet(null)
    if (!session) return
    getRegisteredWallet(session.user.id).then((wallet) => {
      if (wallet) {
        setRegistered(true)
        setRegisteredWallet(wallet)
      }
    }).catch(console.error)
  }, [session?.user.id])

  const walletMatch = connected && anchorWallet?.publicKey.toBase58() === registeredWallet

  async function register(): Promise<string | null> {
    if (!anchorWallet || !connected || !session) return null

    // Start listener before tx so we don't miss the webhook write
    const { promise: dbPromise, cancel: cancelListener } = waitForRegistration(session.user.id)

    setRegistering(true)
    setError(null)
    try {
      const signature = await solanaRegister(connection, anchorWallet)
      await dbPromise  // wait for Helius webhook to confirm DB write
      setRegistered(true)
      return signature
    } catch (err) {
      cancelListener()
      setError(err instanceof Error ? err.message : 'Registration failed')
      return null
    } finally {
      setRegistering(false)
    }
  }

  return { register, registering, registered, registeredWallet, walletMatch, error, connected }
}
