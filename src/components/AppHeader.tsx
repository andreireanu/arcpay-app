import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useDynamicContext,
  useUserWallets,
  useSwitchWallet,
  getAuthToken,
} from '@dynamic-labs/sdk-react-core'
import { isSolanaWallet } from '@dynamic-labs/solana-core'
import { isSuiWallet } from '@dynamic-labs/sui-core'
import { isEmbeddedConnector } from '@dynamic-labs/wallet-connector-core'
import { useAuth } from '../hooks/useAuth'
import { getCurrentRole } from '../supabase/auth/auth'
import { exchangeToken } from '../supabase/auth/exchangeToken'
import StoreIcon from '../assets/icons/StoreIcon'
import LinkIcon from '../assets/icons/LinkIcon'
import TransactionsIcon from '../assets/icons/TransactionsIcon'
import SuiIcon from '../assets/icons/SuiIcon'
import SolIcon from '../assets/icons/SolIcon'
import s from '../styles/dashboard.module.css'

type ConnectedWallet = ReturnType<typeof useUserWallets>[number]

// Human label for which chain a connected wallet lives on. Phantom (and email
// embedded wallets) can be linked on both Solana and Sui — each is a separate
// entry in useUserWallets, so we label by wallet type rather than name.
function chainLabel(wallet: ConnectedWallet): string {
  if (isSolanaWallet(wallet)) return 'Solana'
  if (isSuiWallet(wallet)) return 'Sui'
  return 'Wallet'
}

function shorten(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

// The chain's teardrop/mark for a connected wallet, used as the marker to the
// left of the wallet address. A bit larger than the in-card icons.
function ChainLogo({ wallet }: { wallet: ConnectedWallet }) {
  if (isSuiWallet(wallet)) return <SuiIcon size={24} />
  if (isSolanaWallet(wallet)) return <SolIcon size={24} />
  return null
}

export default function AppHeader() {
  const { signOutUser } = useAuth()
  const { primaryWallet } = useDynamicContext()
  const userWallets = useUserWallets()
  const switchWallet = useSwitchWallet()
  const navigate = useNavigate()
  const walletAddress = primaryWallet?.address

  const [walletMenuOpen, setWalletMenuOpen] = useState(false)
  const [role, setRole] = useState<'seller' | 'buyer'>(getCurrentRole())
  const [switchingRole, setSwitchingRole] = useState(false)
  const walletMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (walletMenuRef.current && !walletMenuRef.current.contains(e.target as Node)) {
        setWalletMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function handleSwitchRole() {
    const newRole = role === 'seller' ? 'buyer' : 'seller'
    const token = getAuthToken()
    if (!token || !walletAddress) return
    setSwitchingRole(true)
    try {
      await exchangeToken(token, walletAddress, newRole)
      setRole(newRole)
      navigate(newRole === 'buyer' ? '/buyer' : '/seller')
    } catch (err) {
      console.error('Failed to switch role', err)
    } finally {
      setSwitchingRole(false)
      setWalletMenuOpen(false)
    }
  }

  // Make the picked wallet primary — the rest of the app reads
  // primaryWallet.address, so this chooses the chain we transact on.
  async function handleSelectWallet(walletId: string) {
    if (walletId !== primaryWallet?.id) {
      try {
        await switchWallet(walletId)
      } catch (err) {
        console.error('Failed to set active wallet', err)
      }
    }
    setWalletMenuOpen(false)
  }

  function copyAddress(address: string) {
    navigator.clipboard.writeText(address)
    setWalletMenuOpen(false)
  }

  const activeChain = primaryWallet ? chainLabel(primaryWallet) : null
  const shortAddress = walletAddress ? shorten(walletAddress) : null

  // Email (and social) logins use Dynamic embedded wallets — one per chain. We
  // don't let those users hop chains from the header: the session is scoped to
  // the chain chosen at login. External-wallet users keep the switcher.
  const emailConnected = primaryWallet?.connector
    ? isEmbeddedConnector(primaryWallet.connector)
    : false
  const walletRows = emailConnected
    ? userWallets.filter((w) => w.id === primaryWallet?.id)
    : userWallets

  return (
    <header className={s.header}>
      <div className={s.headerLeft}>
        <div className={s.logo}>
          <img src="/favicon.svg" alt="" className={s.logoIcon} />
          <span className={s.logoWordmark}>arcpay</span>
        </div>
        <nav className={s.headerNav}>
          <button
            className={s.accountBadge}
            type="button"
            onClick={() => navigate(role === 'buyer' ? '/buyer' : '/seller')}
          >
            <span className={s.accountBadgeIcon}>
              <StoreIcon size={16} />
            </span>
            {role === 'seller' ? 'Seller account' : 'Buyer account'}
          </button>
          {role === 'seller' && (
            <button className={s.navButton} type="button" onClick={() => navigate('/products')}>
              <LinkIcon size={16} />
              Products
            </button>
          )}
          <button className={s.navButton} type="button" onClick={() => navigate('/transactions')}>
            <TransactionsIcon size={16} />
            Transactions
          </button>
        </nav>
      </div>
      <div className={s.headerActions}>
        {shortAddress && primaryWallet && (
          <span className={s.walletChainLogo} title={activeChain ?? undefined}>
            <ChainLogo wallet={primaryWallet} />
          </span>
        )}
        {shortAddress && (
          <div className={s.walletMenu} ref={walletMenuRef}>
            <button
              className={s.walletButton}
              onClick={() => setWalletMenuOpen((o) => !o)}
              title={walletAddress}
            >
              <span className={s.walletRoleBadge}>{role}</span>
              {shortAddress}
            </button>
            {walletMenuOpen && (
              <div className={s.walletDropdown}>
                <span className={s.walletDropdownLabel}>Active wallet</span>
                {walletRows.map((w) => {
                  const active = w.id === primaryWallet?.id
                  return (
                    <div
                      key={w.id}
                      className={`${s.walletChainRow} ${active ? s.walletChainRowActive : ''}`}
                      onClick={emailConnected ? undefined : () => handleSelectWallet(w.id)}
                    >
                      <div className={s.walletChainInfo}>
                        <span className={s.walletChainName}>
                          {chainLabel(w)}
                          {active && <span className={s.walletChainCheck}>✓</span>}
                        </span>
                        <span className={s.walletChainAddr}>{shorten(w.address)}</span>
                      </div>
                      <button
                        className={s.walletChainCopy}
                        onClick={(e) => {
                          e.stopPropagation()
                          copyAddress(w.address)
                        }}
                        title="Copy address"
                        aria-label="Copy address"
                      >
                        ⧉
                      </button>
                    </div>
                  )
                })}
                <div className={s.walletDropdownDivider} />
                <button
                  className={s.walletDropdownItem}
                  onClick={handleSwitchRole}
                  disabled={switchingRole}
                >
                  {switchingRole ? 'Switching…' : `Switch to ${role === 'seller' ? 'buyer' : 'seller'}`}
                </button>
              </div>
            )}
          </div>
        )}
        <button className={s.signOutButton} onClick={() => signOutUser()}>
          Sign out
        </button>
      </div>
    </header>
  )
}
