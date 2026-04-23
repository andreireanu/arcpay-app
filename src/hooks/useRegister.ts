import { useState, useEffect } from 'react'
import { useWallet, useAnchorWallet } from '@solana/wallet-adapter-react'
import { connection } from '../solana/connection'
import { register as solanaRegister } from '../solana/instructions/register'
import { getSession } from '../supabase/auth/auth'
import { isUserRegistered } from '../supabase/sellers/sellers'
import { waitForRegistration } from '../supabase/sellers/realtime'

export function useRegister() {
  const { connected } = useWallet()
  const anchorWallet = useAnchorWallet()
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check DB on mount — user may have registered in a previous session
  useEffect(() => {
    getSession().then((session) => {
      if (!session) return
      isUserRegistered(session.user.id)
        .then((result) => { if (result) setRegistered(true) })
        .catch(console.error)
    }).catch(console.error)
  }, [])

  async function register(): Promise<string | null> {
    if (!anchorWallet || !connected) return null

    const session = await getSession()
    if (!session) return null

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

  return { register, registering, registered, error, connected }
}
