import { usePrivy } from '@privy-io/react-auth'

export function useAuth() {
  const { ready, authenticated, logout } = usePrivy()
  return {
    loading: !ready,
    authenticated,
    signOutUser: logout,
  }
}
