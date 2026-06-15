import { createContext, useContext } from 'react'

// The chain the login auth flow is scoped to. Dynamic's wallet list is filtered
// to this chain (see main.tsx) so the user signs in on the chain they picked,
// while still seeing every login option (email + Phantom) for that chain.
export type AuthChain = 'SOL' | 'SUI'

export interface ChainAuthValue {
  authChain: AuthChain
  setAuthChain: (chain: AuthChain) => void
}

export const ChainAuthContext = createContext<ChainAuthValue | null>(null)

export function useChainAuth(): ChainAuthValue {
  const ctx = useContext(ChainAuthContext)
  if (!ctx) {
    throw new Error('useChainAuth must be used within ChainAuthContext.Provider')
  }
  return ctx
}
