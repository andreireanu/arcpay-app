import { Buffer } from 'buffer/'
;(globalThis as unknown as Record<string, unknown>).Buffer ??= Buffer

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthContextProvider } from './context/AuthContext'
import { SolanaWalletProvider } from './solana/wallet'
import { router } from './router'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SolanaWalletProvider>
      <AuthContextProvider>
        <RouterProvider router={router} />
      </AuthContextProvider>
    </SolanaWalletProvider>
  </StrictMode>,
)
