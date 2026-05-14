import { useEffect, useRef, useState } from 'react'
import { usePrivy } from '@privy-io/react-auth'
import { useSolanaWallets } from '@privy-io/react-auth/solana'
import { useNavigate } from 'react-router-dom'
import { exchangeToken } from '../supabase/auth/exchangeToken'
import s from '../styles/auth.module.css'

export default function Login() {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy()
  const { wallets } = useSolanaWallets()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const exchangingRef = useRef(false)

  const solanaWallet = wallets[0]
  const walletAddress = solanaWallet?.address

  useEffect(() => {
    if (!authenticated || !walletAddress || exchangingRef.current) return
    exchangingRef.current = true
    getAccessToken()
      .then((token) => {
        if (!token) throw new Error('No access token')
        return exchangeToken(token, walletAddress)
      })
      .then(() => navigate('/dashboard'))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Login failed')
        exchangingRef.current = false
        logout()
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, walletAddress])

  const loading = !ready || (authenticated && !error)

  return (
    <div className={s.page}>
      <div className={s.content}>
        <div className={s.logo}>
          <img src="/favicon.svg" alt="ArcPay" className={s.logoImg} />
        </div>

        <h1 className={s.heading}>Sign in</h1>

        {error && <p role="alert" className={s.error}>{error}</p>}

        <button
          className={s.primaryButton}
          onClick={login}
          disabled={loading}
        >
          {loading ? 'Signing in…' : 'Connect wallet'}
        </button>
      </div>
    </div>
  )
}
