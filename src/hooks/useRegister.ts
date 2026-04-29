import { useState, useEffect } from 'react'
import { useWallet, useAnchorWallet } from '@solana/wallet-adapter-react'
import { Buffer } from 'buffer/'
import { isWalletRegistered } from '../supabase/sellers/sellers'
import { buildRegisterMessage, registerWallet } from '../supabase/sol/registerWallet'
import { useAuth } from './useAuth'

export function useRegister() {
  const { session } = useAuth()
  const { connected, signMessage } = useWallet()
  const anchorWallet = useAnchorWallet()
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Check registration status whenever the connected wallet changes
  useEffect(() => {
    setRegistered(false)
    if (!anchorWallet?.publicKey) return
    const wallet = anchorWallet.publicKey.toBase58()
    setChecking(true)
    let cancelled = false
    isWalletRegistered(wallet)
      .then((result) => { if (!cancelled) setRegistered(result) })
      .catch(console.error)
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorWallet?.publicKey?.toBase58()])

  // Auto-trigger sign-message only after DB check completes and wallet is not registered
  useEffect(() => {
    if (!connected || !anchorWallet || !session || registered || registering || checking) return
    const timer = setTimeout(() => { register() }, 500)
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, registered, checking])

  async function register(): Promise<void> {
    if (!anchorWallet || !connected || !session || !signMessage) return

    setRegistering(true)
    setError(null)
    try {
      const wallet = anchorWallet.publicKey.toBase58()
      const message = buildRegisterMessage(wallet)
      const signature = await signMessage(Buffer.from(message, 'utf-8'))
      await registerWallet(wallet, signature)
      setRegistered(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setRegistering(false)
    }
  }

  return { register, registering, registered, error, connected }
}
