import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDynamicContext, getAuthToken } from '@dynamic-labs/sdk-react-core'
import { useAuth } from '../hooks/useAuth'
import { getCurrentRole } from '../supabase/auth/auth'
import { exchangeToken } from '../supabase/auth/exchangeToken'
import StoreIcon from '../assets/icons/StoreIcon'
import LinkIcon from '../assets/icons/LinkIcon'
import TransactionsIcon from '../assets/icons/TransactionsIcon'
import s from '../styles/dashboard.module.css'

export default function AppHeader() {
  const { signOutUser } = useAuth()
  const { primaryWallet } = useDynamicContext()
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
    } catch (err) {
      console.error('Failed to switch role', err)
    } finally {
      setSwitchingRole(false)
      setWalletMenuOpen(false)
    }
  }

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : null

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
            // TODO: route buyers to their own dashboard once it exists.
            onClick={() => navigate('/seller')}
          >
            <span className={s.accountBadgeIcon}>
              <StoreIcon size={16} />
            </span>
            {role === 'seller' ? 'Seller account' : 'Buyer account'}
          </button>
          <button className={s.navButton} type="button" onClick={() => navigate('/products')}>
            <LinkIcon size={16} />
            Products
          </button>
          <button className={s.navButton} type="button" onClick={() => navigate('/transactions')}>
            <TransactionsIcon size={16} />
            Transactions
          </button>
        </nav>
      </div>
      <div className={s.headerActions}>
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
                <button
                  className={s.walletDropdownItem}
                  onClick={() => { navigator.clipboard.writeText(walletAddress!); setWalletMenuOpen(false) }}
                >
                  Copy address
                </button>
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
