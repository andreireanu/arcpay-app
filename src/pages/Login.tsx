import { useEffect, useRef, useState } from 'react'
import { useDynamicContext, getAuthToken } from '@dynamic-labs/sdk-react-core'
import { useNavigate } from 'react-router-dom'
import { exchangeToken } from '../supabase/auth/exchangeToken'
import s from '../styles/auth.module.css'

export default function Login() {
  const { sdkHasLoaded, user, setShowAuthFlow, handleLogOut, primaryWallet } = useDynamicContext()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const exchangingRef = useRef(false)

  const walletAddress = primaryWallet?.address

  useEffect(() => {
    const token = getAuthToken()
    if (!user || !walletAddress || !token || exchangingRef.current) return
    exchangingRef.current = true
    exchangeToken(token, walletAddress)
      .then(() => navigate('/dashboard'))
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Login failed')
        exchangingRef.current = false
        handleLogOut()
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, walletAddress])

  const loading = !sdkHasLoaded || (!!user && !error)

  const buttonDisabled = loading
  const buttonLabel = loading ? 'Signing in…' : 'Connect wallet'

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
          onClick={() => setShowAuthFlow(true)}
          disabled={buttonDisabled}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  )
}
