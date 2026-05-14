import { Buffer } from 'buffer/'
;(globalThis as unknown as Record<string, unknown>).Buffer ??= Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { DynamicContextProvider } from '@dynamic-labs/sdk-react-core'
import { SolanaWalletConnectors } from '@dynamic-labs/solana'
import { DynamicWaasSVMConnectors } from '@dynamic-labs/waas-svm'
import { ConnectionProvider } from '@solana/wallet-adapter-react'
import { AuthContextProvider } from './context/AuthContext'
import { config } from './config/env'
import { router } from './router'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DynamicContextProvider
      settings={{
        environmentId: config.dynamic.environmentId,
        walletConnectors: [SolanaWalletConnectors, DynamicWaasSVMConnectors],
        walletsFilter: (wallets) =>
          wallets.filter((w) => w.key === 'phantom' || w.key === 'turnkeyhd' || w.key === 'dynamicwaas'),
      }}
    >
      <ConnectionProvider endpoint={config.solana.rpcUrl}>
        <AuthContextProvider>
          <RouterProvider router={router} />
        </AuthContextProvider>
      </ConnectionProvider>
    </DynamicContextProvider>
  </StrictMode>,
)
