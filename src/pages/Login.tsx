import { useEffect, useRef, useState } from 'react'
import {
  useDynamicContext,
  useUserWallets,
  useSwitchWallet,
  getAuthToken,
} from '@dynamic-labs/sdk-react-core'
import { isSolanaWallet } from '@dynamic-labs/solana-core'
import { isSuiWallet } from '@dynamic-labs/sui-core'
import { useNavigate } from 'react-router-dom'
import { exchangeToken } from '../supabase/auth/exchangeToken'
import { getActiveChain, setActiveChain, getCurrentRole, type AppChain } from '../supabase/auth/auth'
import { useChainAuth } from '../context/ChainAuthContext'
import suiWordmark from '../assets/sui.svg'
import solanaWordmark from '../assets/solana.svg'
import s from '../styles/auth.module.css'

// App chain → Dynamic connector chain symbol. The auth flow is scoped to this
// chain, so the sign-in message is signed on the chain the user picked.
const DYNAMIC_CHAIN: Record<AppChain, 'SOL' | 'SUI'> = {
  solana: 'SOL',
  sui: 'SUI',
}

export default function Login() {
  const { sdkHasLoaded, user, handleLogOut, primaryWallet, setShowAuthFlow, showAuthFlow } =
    useDynamicContext()
  const userWallets = useUserWallets()
  const switchWallet = useSwitchWallet()
  const { setAuthChain } = useChainAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  // Which chain is mid-login, so we can show a per-button label.
  const [connectingChain, setConnectingChain] = useState<AppChain | null>(null)
  const exchangingRef = useRef(false)

  // Once authenticated, pin the session to the wallet on the chain the user
  // picked, then exchange the Dynamic token for a Supabase session keyed to that
  // address. Phantom links BOTH its Solana and Sui accounts to the Dynamic user,
  // so primaryWallet may be the other chain — we select by chain explicitly and
  // make it primary so the rest of the app loads the right chain's data.
  useEffect(() => {
    const token = getAuthToken()
    if (!user || !token || exchangingRef.current) return
    const chain = getActiveChain()
    const target = userWallets.find((w) =>
      chain === 'sui' ? isSuiWallet(w) : isSolanaWallet(w),
    )
    if (!target) return // wait until the chosen chain's wallet is linked
    exchangingRef.current = true
    // A fresh login via the chain buttons (connectingChain set) is a seller
    // sign-in. For an already-authenticated user just landing here (e.g. a buyer
    // from the pay page navigating home), keep their current role instead of
    // forcing seller.
    const role = connectingChain ? 'seller' : getCurrentRole()
    ;(async () => {
      if (target.id !== primaryWallet?.id) await switchWallet(target.id)
      await exchangeToken(token, target.address, role)
      setShowAuthFlow(false)
      navigate(role === 'buyer' ? '/buyer' : '/seller')
    })().catch((err) => {
      setError(err instanceof Error ? err.message : 'Login failed')
      exchangingRef.current = false
      setConnectingChain(null)
      handleLogOut()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, userWallets])

  // If the user closes the auth flow without authenticating, clear the pending
  // label so the buttons return to their default state.
  useEffect(() => {
    if (!showAuthFlow && !user) setConnectingChain(null)
  }, [showAuthFlow, user])

  function handleConnect(chain: AppChain) {
    if (!sdkHasLoaded || connectingChain) return
    setError(null)
    setConnectingChain(chain)
    // Persist the choice and scope the auth flow to this chain before opening it,
    // so the wallet list (email + Phantom) is filtered to the picked chain.
    setActiveChain(chain)
    setAuthChain(DYNAMIC_CHAIN[chain])
    setShowAuthFlow(true)
  }

  return (
    <div className={s.page}>
      <div className={s.content}>
        <div className={s.logo}>
          <img src="/favicon.svg" alt="ArcPay" className={s.logoImg} />
        </div>

        <h1 className={s.heading}>Choose a chain to sign in</h1>

        {error && <p role="alert" className={s.error}>{error}</p>}

        <div className={s.actions}>
          <button
            className={s.chainButtonSui}
            onClick={() => handleConnect('sui')}
            disabled={!sdkHasLoaded || !!connectingChain}
          >
            {connectingChain === 'sui' ? (
              'Signing in…'
            ) : (
              <>
                Continue with
                <img src={suiWordmark} alt="Sui" className={s.suiWordmark} />
              </>
            )}
          </button>

          <button
            className={s.chainButtonSecondary}
            onClick={() => handleConnect('solana')}
            disabled={!sdkHasLoaded || !!connectingChain}
          >
            {connectingChain === 'solana' ? (
              'Signing in…'
            ) : (
              <>
                Continue with
                <img src={solanaWordmark} alt="Solana" className={s.solanaWordmark} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
