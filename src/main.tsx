import { Buffer } from 'buffer/'
;(globalThis as unknown as Record<string, unknown>).Buffer ??= Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { PrivyProvider } from '@privy-io/react-auth'
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana'
import { ConnectionProvider } from '@solana/wallet-adapter-react'
import { AuthContextProvider } from './context/AuthContext'
import { config } from './config/env'
import { router } from './router'
import './index.css'

const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={config.privy.appId}
      config={{
        loginMethods: ['wallet', 'email'],
        appearance: {
          theme: 'dark',
          accentColor: '#ffffff',
          logo: `${window.location.origin}/favicon.svg`,
          walletList: ['phantom', 'detected_solana_wallets'],
        },
        embeddedWallets: {
          solana: { createOnLogin: 'users-without-wallets' },
        },
        externalWallets: { solana: { connectors: solanaConnectors } },
      }}
    >
      <ConnectionProvider endpoint={config.solana.rpcUrl}>
        <AuthContextProvider>
          <RouterProvider router={router} />
        </AuthContextProvider>
      </ConnectionProvider>
    </PrivyProvider>
  </StrictMode>,
)
